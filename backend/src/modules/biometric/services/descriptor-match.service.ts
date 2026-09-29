import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaceComparisonResult } from './aws-rekognition.service';

/**
 * Result of comparing two descriptors, with the raw distance kept so a
 * failure can be explained in numbers rather than a bare "no match".
 */
export interface DescriptorComparisonResult extends FaceComparisonResult {
  distance: number;
  threshold: number;
}

/** How many floats a face-api face recognition descriptor contains. */
export const FACE_DESCRIPTOR_LENGTH = 128;

/**
 * Face matching against descriptors computed in the browser.
 *
 * Why this exists rather than AWS Rekognition or a self-hosted InsightFace:
 * both of those take an *image* and are billed or hosted per call. The
 * phones already have a camera and a browser, so they compute the 128-d
 * descriptor locally with face-api and send only the vector. The comparison
 * itself stays on the server -- a client that could decide its own verdict
 * could simply declare every face a match.
 *
 * This service is pure arithmetic, so unlike the other two matchers it is
 * always available.
 */
@Injectable()
export class DescriptorMatchService {
  private readonly logger = new Logger(DescriptorMatchService.name);

  /**
   * Maximum Euclidean distance that still counts as the same person.
   *
   * 0.6 is the figure face-api's own documentation gives for its 128-d
   * descriptor: comfortably below the ~0.6-1.0 distances unrelated faces
   * produce, without demanding so exact a capture that ordinary lighting
   * differences fail. Tightening it rejects more impostors at the cost of
   * more false rejections for the legitimate employee.
   *
   * Public so callers can quote the actual bound in an error message.
   */
  readonly maxDistance: number;

  constructor(private readonly configService: ConfigService) {
    this.maxDistance = parseFloat(
      this.configService.get<string>('FACE_DESCRIPTOR_MAX_DISTANCE', '0.6'),
    );

    if (!Number.isFinite(this.maxDistance) || this.maxDistance <= 0) {
      throw new Error(
        `FACE_DESCRIPTOR_MAX_DISTANCE must be a positive number, got "${this.configService.get<string>('FACE_DESCRIPTOR_MAX_DISTANCE')}"`,
      );
    }
  }

  isAvailable(): boolean {
    return true;
  }

  /**
   * Reject anything that is not a plausible descriptor before it reaches the
   * distance calculation, so a malformed payload fails with a clear message
   * instead of silently comparing as NaN (which would make `NaN <= maxDistance`
   * false and look like an innocent non-match).
   */
  isValidDescriptor(value: unknown): value is number[] {
    if (!Array.isArray(value)) return false;
    if (value.length !== FACE_DESCRIPTOR_LENGTH) return false;
    return value.every(
      (component) => typeof component === 'number' && Number.isFinite(component),
    );
  }

  /**
   * Euclidean distance between two descriptors. Lower means more alike.
   */
  distance(a: number[], b: number[]): number {
    let sumOfSquares = 0;
    for (let i = 0; i < a.length; i += 1) {
      const delta = a[i] - b[i];
      sumOfSquares += delta * delta;
    }
    return Math.sqrt(sumOfSquares);
  }

  /**
   * Compare a freshly captured descriptor against an enrolled one.
   *
   * `confidence` is reported as `1 - distance` so it still reads as
   * "higher is better" alongside the AWS/InsightFace matchers, and
   * `threshold` is reported as `1 - maxDistance`. That keeps the caller's
   * existing `confidence >= threshold` check arithmetically equivalent to
   * `distance <= maxDistance`, rather than silently inverting the meaning of
   * the number it was already comparing.
   */
  compareDescriptors(
    captured: number[],
    enrolled: number[],
  ): DescriptorComparisonResult {
    if (!this.isValidDescriptor(captured)) {
      throw new Error(
        `Captured descriptor must be an array of ${FACE_DESCRIPTOR_LENGTH} finite numbers`,
      );
    }
    if (!this.isValidDescriptor(enrolled)) {
      throw new Error(
        `Enrolled descriptor must be an array of ${FACE_DESCRIPTOR_LENGTH} finite numbers`,
      );
    }

    const distance = this.distance(captured, enrolled);
    const threshold = 1 - this.maxDistance;
    // Distance can exceed 1 (unrelated faces land near 1.0, and a corrupted
    // capture can go higher), so clamp rather than report a negative
    // confidence.
    const confidence = Math.max(0, Math.min(1, 1 - distance));

    return {
      match: distance <= this.maxDistance,
      confidence,
      distance,
      threshold,
      faceQuality: 1,
    };
  }

  /**
   * Best match across every active enrollment for the employee.
   *
   * An employee may have enrolled on more than one handset; any of them
   * identifying them is a success, so the closest wins.
   */
  findBestMatch(
    captured: number[],
    enrolledDescriptors: number[][],
  ): DescriptorComparisonResult | null {
    let best: DescriptorComparisonResult | null = null;

    for (const enrolled of enrolledDescriptors) {
      if (!this.isValidDescriptor(enrolled)) {
        this.logger.warn('Skipping an enrollment with a malformed descriptor');
        continue;
      }

      const result = this.compareDescriptors(captured, enrolled);
      if (!best || result.distance < best.distance) {
        best = result;
      }
    }

    return best;
  }

  /**
   * Client-reported capture checks.
   *
   * These come from the phone and are therefore advisory, not a security
   * control -- a tampered client can report whatever it likes. They exist to
   * give an honest user a clear "hold still / move closer" message before a
   * bad capture burns one of their login attempts. The actual identity
   * decision never depends on them.
   */
  assessCaptureQuality(faceCount: number, detectionScore: number): string | null {
    if (faceCount === 0) return 'No face detected. Centre your face in the frame.';
    if (faceCount > 1) return 'More than one face detected. Only you should be in frame.';
    if (detectionScore < 0.5) {
      return 'Face not clear enough. Move to better light and hold still.';
    }
    return null;
  }
}
