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
import { EnrollFaceDto, EnrollFaceResponseDto } from './dto/enroll-face.dto';
import { VerifyFaceDto, VerifyFaceResponseDto } from './dto/verify-face.dto';

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
    private configService: ConfigService,
  ) {
    // Determine which face matching service to use (priority: AWS > InsightFace)
    if (this.awsRekognitionService.isAvailable()) {
      this.faceMatchingService = 'aws';
      this.logger.log('Using AWS Rekognition for face matching');
    } else if (this.insightFaceService.isAvailable()) {
      this.faceMatchingService = 'insightface';
      this.logger.log('Using self-hosted InsightFace for face matching');
    } else {
      this.faceMatchingService = 'none';
      this.logger.warn('No face matching service available. Biometric verification disabled.');
    }
  }

  /**
   * Enroll a new face for an employee
   */
  async enrollFace(
    organizationId: string,
    enrollDto: EnrollFaceDto,
  ): Promise<EnrollFaceResponseDto> {
    // Verify employee exists and belongs to organization
    const employee = await this.employeeRepository.findOne({
      where: { id: enrollDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee ${enrollDto.employeeId} not found in organization`,
      );
    }

    // Check if skip biometric verification is enabled (dev mode)
    const skipBiometric = this.configService.get<string>(
      'DEV_SKIP_BIOMETRIC_VERIFICATION',
      'false',
    ) === 'true';

    let faceQuality = 1.0;

    if (!skipBiometric && this.faceMatchingService !== 'none') {
      // Assess face quality using available service
      if (this.faceMatchingService === 'aws') {
        faceQuality = await this.awsRekognitionService.assessFaceQuality(
          enrollDto.faceImage,
        );
      } else if (this.faceMatchingService === 'insightface') {
        faceQuality = await this.insightFaceService.assessFaceQuality(
          enrollDto.faceImage,
        );
      }

      if (faceQuality < 0.5) {
        throw new BadRequestException(
          'Face image quality too low. Please capture in better lighting.',
        );
      }

      // Check liveness (prevent photo spoofing)
      let livenessResult;
      if (this.faceMatchingService === 'aws') {
        livenessResult = await this.awsRekognitionService.detectFaceLiveness(
          enrollDto.faceImage,
        );
      } else if (this.faceMatchingService === 'insightface') {
        livenessResult = await this.insightFaceService.detectFaceLiveness(
          enrollDto.faceImage,
        );
      }

      if (livenessResult && !livenessResult.livenessCheck) {
        throw new BadRequestException(
          'Liveness check failed. Please ensure live face capture (not a photo).',
        );
      }
    }

    // Check if enrollment already exists for this device
    let enrollment = await this.deviceEnrollmentRepository.findOne({
      where: {
        employeeId: enrollDto.employeeId,
        deviceIdentifier: enrollDto.deviceIdentifier || 'default',
      },
    });

    if (enrollment) {
      // Update existing enrollment
      enrollment.faceEmbeddingData = enrollDto.faceImage; // Store base64 temporarily
      enrollment.enrolledAt = new Date();
      enrollment.isRevoked = false;
    } else {
      // Create new enrollment
      enrollment = this.deviceEnrollmentRepository.create({
        employeeId: enrollDto.employeeId,
        deviceIdentifier: enrollDto.deviceIdentifier || 'default',
        deviceName: enrollDto.deviceName || 'Unknown Device',
        faceEmbeddingData: enrollDto.faceImage, // In production, store only embedding
        enrolledAt: new Date(),
        isRevoked: false,
      });
    }

    await this.deviceEnrollmentRepository.save(enrollment);

    this.logger.log(
      `Face enrolled for employee ${enrollDto.employeeId} on device ${enrollDto.deviceIdentifier}`,
    );

    return {
      success: true,
      enrollmentId: enrollment.id,
      faceQuality,
      message: 'Face enrolled successfully',
    };
  }

  /**
   * Verify a face against enrolled biometric
   */
  async verifyFace(
    organizationId: string,
    verifyDto: VerifyFaceDto,
  ): Promise<VerifyFaceResponseDto> {
    // Verify employee exists
    const employee = await this.employeeRepository.findOne({
      where: { id: verifyDto.employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException(
        `Employee ${verifyDto.employeeId} not found in organization`,
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

    if (!this.faceMatchingService || this.faceMatchingService === 'none') {
      throw new BadRequestException(
        'Face matching service not available. Please configure AWS Rekognition or InsightFace.',
      );
    }

    // Try matching against all enrollments (device-agnostic by default)
    let bestMatch = { match: false, confidence: 0 };

    for (const enrollment of enrollments) {
      try {
        let result;
        if (this.faceMatchingService === 'aws') {
          result = await this.awsRekognitionService.compareFaces(
            verifyDto.faceImage,
            enrollment.faceEmbeddingData,
          );
        } else if (this.faceMatchingService === 'insightface') {
          result = await this.insightFaceService.compareFaces(
            verifyDto.faceImage,
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
  ): Promise<void> {
    const enrollment = await this.deviceEnrollmentRepository.findOne({
      where: { id: enrollmentId },
      relations: ['employee'],
    });

    if (!enrollment || enrollment.employee.organizationId !== organizationId) {
      throw new NotFoundException('Enrollment not found');
    }

    enrollment.isRevoked = true;
    enrollment.revokedAt = new Date();
    await this.deviceEnrollmentRepository.save(enrollment);

    this.logger.log(`Enrollment ${enrollmentId} revoked`);
  }

  /**
   * Get all enrollments for an employee
   */
  async getEmployeeEnrollments(
    organizationId: string,
    employeeId: string,
  ): Promise<DeviceEnrollment[]> {
    const employee = await this.employeeRepository.findOne({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return this.deviceEnrollmentRepository.find({
      where: { employeeId },
      order: { enrolledAt: 'DESC' },
    });
  }
}
