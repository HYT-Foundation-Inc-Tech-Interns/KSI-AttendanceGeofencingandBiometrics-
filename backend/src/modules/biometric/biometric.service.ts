import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Employee, DeviceEnrollment } from '../../database/entities';
import { AwsRekognitionService } from './services/aws-rekognition.service';
import { InsightFaceService } from './services/insightface.service';
import {
  DescriptorMatchService,
  FACE_DESCRIPTOR_LENGTH,
} from './services/descriptor-match.service';
import {
  ActingUser,
  assertMayActForEmployee,
  assertMayReadEmployee,
} from '../../common/utils/employee-scope';
import { EnrollFaceDto, EnrollFaceResponseDto } from './dto/enroll-face.dto';
import { VerifyFaceDto, VerifyFaceResponseDto } from './dto/verify-face.dto';

/**
 * What a client is told about an enrollment. Note the absence of
 * `faceDescriptor` -- see getEmployeeEnrollments for why.
 */
export interface EnrollmentSummary {
  id: string;
  deviceIdentifier: string | null;
  deviceName: string | null;
  isRevoked: boolean;
  enrolledAt: Date;
  faceEmbeddingRef: string;
  hasDescriptor: boolean;
}

/**
 * Records where an enrollment's embedding actually lives, so the NOT NULL
 * `face_embedding_ref` column says something true instead of being filled
 * with a placeholder.
 */
const EMBEDDING_REF_DESCRIPTOR = 'inline:face_descriptor';
const EMBEDDING_REF_IMAGE = 'inline:face_embedding_data';

/**
 * Used when a phone enrolls without telling us which handset it is. The
 * column is NOT NULL, and inventing a per-enrollment random id would make
 * every enrollment look like a distinct device, so a shared placeholder is
 * the honest value.
 */
const UNKNOWN_DEVICE_ID = 'unregistered-device';

@Injectable()
export class BiometricService {
  private readonly logger = new Logger(BiometricService.name);
  private readonly faceMatchingService: 'aws' | 'insightface' | 'none';

  constructor(
    @InjectRepository(Employee)
    private employeeRepository: Repository<Employee>,
    @InjectRepository(DeviceEnrollment)
    private deviceEnrollmentRepository: Repository<DeviceEnrollment>,
    private awsRekognitionService: AwsRekognitionService,
    private insightFaceService: InsightFaceService,
    private descriptorMatchService: DescriptorMatchService,
    private configService: ConfigService,
  ) {
    /*
     * Determine which image-based face matching service to use
     * (priority: AWS > InsightFace).
     *
     * This only affects the legacy image path. Descriptor matching runs
     * in-process and is always available, so biometric verification is
     * functional even when neither of these is configured -- which is the
     * case on this deployment.
     */
    if (this.awsRekognitionService.isAvailable()) {
      this.faceMatchingService = 'aws';
      this.logger.log('Using AWS Rekognition for face matching');
    } else if (this.insightFaceService.isAvailable()) {
      this.faceMatchingService = 'insightface';
      this.logger.log('Using self-hosted InsightFace for face matching');
    } else {
      this.faceMatchingService = 'none';
      this.logger.log(
        'No external face service configured; using in-process descriptor matching',
      );
    }
  }

  /**
   * Enroll a new face for an employee
   */
  async enrollFace(
    organizationId: string,
    enrollDto: EnrollFaceDto,
    actor: ActingUser,
  ): Promise<EnrollFaceResponseDto> {
    // Enrolling a face is establishing a credential, so it is at least as
    // sensitive as using one.
    assertMayActForEmployee(actor, enrollDto.employeeId);

    // Verify employee exists and belongs to organization
    const employee = await this.employeeRepository.findOne({
      where: { id: enrollDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee ${enrollDto.employeeId} not found in organization`,
      );
    }

    const descriptor = enrollDto.faceDescriptor;

    if (!descriptor && !enrollDto.faceImage) {
      throw new BadRequestException(
        'Supply either faceDescriptor (preferred) or faceImage.',
      );
    }

    if (
      descriptor &&
      !this.descriptorMatchService.isValidDescriptor(descriptor)
    ) {
      throw new BadRequestException(
        `faceDescriptor must be an array of ${FACE_DESCRIPTOR_LENGTH} finite numbers.`,
      );
    }

    // Check if skip biometric verification is enabled (dev mode)
    const skipBiometric = this.configService.get<string>(
      'DEV_SKIP_BIOMETRIC_VERIFICATION',
      'false',
    ) === 'true';

    let faceQuality = 1.0;

    /*
     * Quality and liveness assessment both need an image to look at. A
     * descriptor carries none, so when the phone takes that path the capture
     * checks have already happened on-device and there is nothing here to
     * assess.
     */
    if (!descriptor && !skipBiometric && this.faceMatchingService !== 'none') {
      // The guard above proved an image is present on this branch.
      faceQuality = await this.assessImageCapture(enrollDto.faceImage as string);
    }

    const deviceIdentifier = enrollDto.deviceIdentifier || 'default';

    // Check if enrollment already exists for this device
    let enrollment = await this.deviceEnrollmentRepository.findOne({
      where: {
        employeeId: enrollDto.employeeId,
        deviceIdentifier,
      },
    });

    if (enrollment) {
      // Re-enrolling clears any earlier revocation rather than leaving the
      // record half-revoked.
      enrollment.enrolledAt = new Date();
      enrollment.isRevoked = false;
      enrollment.revokedAt = null;
      enrollment.revokedBy = null;
      enrollment.revokeReason = null;
    } else {
      enrollment = this.deviceEnrollmentRepository.create({
        employeeId: enrollDto.employeeId,
        deviceIdentifier,
        deviceName: enrollDto.deviceName || 'Unknown Device',
        enrolledAt: new Date(),
        isRevoked: false,
      });
    }

    /*
     * `device_id` and `face_embedding_ref` are NOT NULL in the live schema and
     * were never assigned here. That omission is exactly what made this
     * endpoint return 500 on every call, which went unnoticed because
     * DEV_SKIP_BIOMETRIC_VERIFICATION meant nobody needed an enrollment.
     */
    enrollment.deviceId = enrollDto.deviceIdentifier || UNKNOWN_DEVICE_ID;

    if (descriptor) {
      enrollment.faceDescriptor = descriptor;
      enrollment.faceEmbeddingRef = EMBEDDING_REF_DESCRIPTOR;
      // Only the vector is retained; the captured photo is discarded rather
      // than written to the database.
      enrollment.faceEmbeddingData = null;
    } else {
      // Legacy image path: the reference image is what gets compared later,
      // so it has to be kept.
      enrollment.faceDescriptor = null;
      enrollment.faceEmbeddingRef = EMBEDDING_REF_IMAGE;
      enrollment.faceEmbeddingData = enrollDto.faceImage ?? null;
    }

    await this.deviceEnrollmentRepository.save(enrollment);

    this.logger.log(
      `Face enrolled for employee ${enrollDto.employeeId} on device ${deviceIdentifier}` +
        (descriptor ? ' (descriptor)' : ' (image)'),
    );

    return {
      success: true,
      enrollmentId: enrollment.id,
      faceQuality,
      message: 'Face enrolled successfully',
    };
  }

  /**
   * Quality and liveness assessment for the image-based path.
   *
   * Only reached when an external matcher (AWS Rekognition or InsightFace) is
   * configured; the descriptor path has no image to assess. Returns the
   * quality score, and throws when the capture is unusable.
   */
  private async assessImageCapture(faceImage: string): Promise<number> {
    let faceQuality = 1.0;

    if (this.faceMatchingService === 'aws') {
      faceQuality = await this.awsRekognitionService.assessFaceQuality(faceImage);
    } else if (this.faceMatchingService === 'insightface') {
      faceQuality = await this.insightFaceService.assessFaceQuality(faceImage);
    }

    if (faceQuality < 0.5) {
      throw new BadRequestException(
        'Face image quality too low. Please capture in better lighting.',
      );
    }

    // Check liveness (prevent photo spoofing)
    let livenessResult;
    if (this.faceMatchingService === 'aws') {
      livenessResult = await this.awsRekognitionService.detectFaceLiveness(faceImage);
    } else if (this.faceMatchingService === 'insightface') {
      livenessResult = await this.insightFaceService.detectFaceLiveness(faceImage);
    }

    if (livenessResult && !livenessResult.livenessCheck) {
      throw new BadRequestException(
        'Liveness check failed. Please ensure live face capture (not a photo).',
      );
    }

    return faceQuality;
  }

  /**
   * Verify a face against enrolled biometric
   */
  async verifyFace(
    organizationId: string,
    verifyDto: VerifyFaceDto,
    actor: ActingUser,
  ): Promise<VerifyFaceResponseDto> {
    // Without this, an employee could probe whether their face matches a
    // colleague's enrollment -- an oracle for someone else's biometric.
    assertMayActForEmployee(actor, verifyDto.employeeId);

    // Verify employee exists
    const employee = await this.employeeRepository.findOne({
      where: { id: verifyDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee ${verifyDto.employeeId} not found in organization`,
      );
    }

    /*
     * Checked before the dev-mode shortcut so a caller sending an empty
     * payload gets told that, rather than a cheerful "verification skipped"
     * that hides the mistake.
     */
    if (!verifyDto.faceDescriptor && !verifyDto.faceImage) {
      throw new BadRequestException(
        'Supply either faceDescriptor (preferred) or faceImage.',
      );
    }

    // Check if skip biometric verification is enabled (dev mode)
    const skipBiometric = this.configService.get<string>(
      'DEV_SKIP_BIOMETRIC_VERIFICATION',
      'false',
    ) === 'true';

    if (skipBiometric) {
      this.logger.warn('DEV MODE: Skipping biometric verification');
      return {
        verified: true,
        confidence: 1.0,
        message: 'DEV MODE: Verification skipped',
      };
    }

    // Find enrollment for this employee
    const enrollments = await this.deviceEnrollmentRepository.find({
      where: { employeeId: verifyDto.employeeId, isRevoked: false },
    });

    if (enrollments.length === 0) {
      throw new BadRequestException(
        `No face enrollment found for employee ${verifyDto.employeeId}. Please enroll first.`,
      );
    }

    /*
     * Descriptor path.
     *
     * The phone computed this vector locally; everything that decides the
     * outcome happens here, so a modified client cannot simply assert that
     * its own face matched.
     */
    if (verifyDto.faceDescriptor) {
      if (!this.descriptorMatchService.isValidDescriptor(verifyDto.faceDescriptor)) {
        throw new BadRequestException(
          `faceDescriptor must be an array of ${FACE_DESCRIPTOR_LENGTH} finite numbers.`,
        );
      }

      const enrolledDescriptors = enrollments
        .map((enrollment) => enrollment.faceDescriptor)
        .filter((value): value is number[] =>
          this.descriptorMatchService.isValidDescriptor(value),
        );

      if (enrolledDescriptors.length === 0) {
        throw new BadRequestException(
          `Employee ${verifyDto.employeeId} has no usable face enrollment. Please re-enroll.`,
        );
      }

      const best = this.descriptorMatchService.findBestMatch(
        verifyDto.faceDescriptor,
        enrolledDescriptors,
      );

      if (!best) {
        throw new BadRequestException(
          `Employee ${verifyDto.employeeId} has no usable face enrollment. Please re-enroll.`,
        );
      }

      if (!best.match) {
        this.logger.warn(
          `Descriptor mismatch for employee ${verifyDto.employeeId}: distance ${best.distance.toFixed(4)} > ${this.descriptorMatchService.maxDistance}`,
        );
        throw new UnauthorizedException(
          `Face verification failed. Distance ${best.distance.toFixed(3)} exceeded the maximum of ${(1 - best.threshold).toFixed(3)}.`,
        );
      }

      this.logger.log(
        `Face verified for employee ${verifyDto.employeeId} (distance ${best.distance.toFixed(4)}, confidence ${(best.confidence * 100).toFixed(1)}%)`,
      );

      return {
        verified: true,
        confidence: best.confidence,
        threshold: best.threshold,
        message: 'Face verification successful',
      };
    }

    if (!this.faceMatchingService || this.faceMatchingService === 'none') {
      throw new BadRequestException(
        'Face matching service not available. Please configure AWS Rekognition or InsightFace.',
      );
    }

    /*
     * Legacy image path. Captured once into a local so the narrowing survives
     * the awaits inside the loop below.
     */
    const capturedImage = verifyDto.faceImage;
    if (!capturedImage) {
      throw new BadRequestException(
        'faceImage is required when faceDescriptor is not supplied.',
      );
    }

    // Try matching against all enrollments (device-agnostic by default)
    let bestMatch = { match: false, confidence: 0 };

    for (const enrollment of enrollments) {
      // An enrollment made from a descriptor has no reference image to
      // compare against, so it cannot serve the image path.
      if (!enrollment.faceEmbeddingData) {
        this.logger.warn(
          `Skipping enrollment ${enrollment.id}: it has no reference image`,
        );
        continue;
      }

      try {
        let result;
        if (this.faceMatchingService === 'aws') {
          result = await this.awsRekognitionService.compareFaces(
            capturedImage,
            enrollment.faceEmbeddingData,
          );
        } else if (this.faceMatchingService === 'insightface') {
          result = await this.insightFaceService.compareFaces(
            capturedImage,
            enrollment.faceEmbeddingData,
          );
        }

        if (result && result.confidence > bestMatch.confidence) {
          bestMatch = result;
        }
      } catch (error) {
        this.logger.error(
          `Face comparison failed for enrollment ${enrollment.id}`,
          error.stack,
        );
      }
    }

    const threshold = parseFloat(
      this.configService.get<string>('FACE_MATCH_THRESHOLD', '0.85'),
    );

    if (!bestMatch.match || bestMatch.confidence < threshold) {
      throw new UnauthorizedException(
        `Face verification failed. Confidence: ${(bestMatch.confidence * 100).toFixed(1)}%, Required: ${(threshold * 100).toFixed(1)}%`,
      );
    }

    this.logger.log(
      `Face verified for employee ${verifyDto.employeeId} with confidence ${(bestMatch.confidence * 100).toFixed(1)}%`,
    );

    return {
      verified: true,
      confidence: bestMatch.confidence,
      threshold,
      message: 'Face verification successful',
    };
  }

  /**
   * Revoke a device enrollment
   */
  async revokeEnrollment(
    organizationId: string,
    enrollmentId: string,
    actor: ActingUser,
  ): Promise<void> {
    const enrollment = await this.deviceEnrollmentRepository.findOne({
      where: { id: enrollmentId },
      relations: ['employee'],
    });

    if (!enrollment || enrollment.employee.organizationId !== organizationId) {
      throw new NotFoundException('Enrollment not found');
    }

    // Revoking someone else's enrollment would lock them out of check-in.
    assertMayActForEmployee(actor, enrollment.employeeId);

    enrollment.isRevoked = true;
    enrollment.revokedAt = new Date();
    await this.deviceEnrollmentRepository.save(enrollment);

    this.logger.log(`Enrollment ${enrollmentId} revoked`);
  }

  /**
   * Get all enrollments for an employee, minus the biometric itself.
   */
  async getEmployeeEnrollments(
    organizationId: string,
    employeeId: string,
    actor: ActingUser,
  ): Promise<EnrollmentSummary[]> {
    assertMayReadEmployee(actor, employeeId);

    const employee = await this.employeeRepository.findOne({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const enrollments = await this.deviceEnrollmentRepository.find({
      where: { employeeId },
      order: { enrolledAt: 'DESC' },
    });

    /*
     * The descriptor is deliberately withheld.
     *
     * A 128-d vector is not a photo, but it IS the credential: whoever holds
     * it can send it as their own `faceDescriptor` and be accepted as this
     * employee. Returning it to a browser would turn "verify this face" into
     * "paste this number", so clients only ever learn whether an enrollment
     * exists.
     */
    return enrollments.map((enrollment) => ({
      id: enrollment.id,
      deviceIdentifier: enrollment.deviceIdentifier,
      deviceName: enrollment.deviceName,
      isRevoked: enrollment.isRevoked,
      enrolledAt: enrollment.enrolledAt,
      faceEmbeddingRef: enrollment.faceEmbeddingRef,
      hasDescriptor: this.descriptorMatchService.isValidDescriptor(
        enrollment.faceDescriptor,
      ),
    }));
  }
}
