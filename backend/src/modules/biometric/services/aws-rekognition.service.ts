import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RekognitionClient,
  CompareFacesCommand,
  DetectFacesCommand,
  FaceDetail,
} from '@aws-sdk/client-rekognition';

export interface FaceComparisonResult {
  match: boolean;
  confidence: number;
  faceQuality?: number;
}

export interface LivenessResult {
  livenessCheck: boolean;
  confidence: number;
  eyesOpen?: boolean;
  mouthOpen?: boolean;
}

@Injectable()
export class AwsRekognitionService {
  private readonly logger = new Logger(AwsRekognitionService.name);
  private rekognitionClient: RekognitionClient;
  private faceMatchThreshold: number;
  private livenessThreshold: number;

  constructor(private configService: ConfigService) {
    const awsRegion = this.configService.get<string>('AWS_REGION', 'ap-southeast-1');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    if (accessKeyId && secretAccessKey) {
      this.rekognitionClient = new RekognitionClient({
        region: awsRegion,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log(`AWS Rekognition initialized in region: ${awsRegion}`);
    } else {
      this.logger.warn('AWS credentials not configured. Rekognition disabled.');
    }

    this.faceMatchThreshold = parseFloat(
      this.configService.get<string>('FACE_MATCH_THRESHOLD', '0.85'),
    );
    this.livenessThreshold = parseFloat(
      this.configService.get<string>('LIVENESS_THRESHOLD', '0.7'),
    );
  }

  /**
   * Compare two face images using AWS Rekognition
   */
  async compareFaces(
    sourceImageBase64: string,
    targetImageBase64: string,
  ): Promise<FaceComparisonResult> {
    if (!this.rekognitionClient) {
      throw new Error('AWS Rekognition not configured');
    }

    try {
      const sourceBytes = this.base64ToBuffer(sourceImageBase64);
      const targetBytes = this.base64ToBuffer(targetImageBase64);

      const command = new CompareFacesCommand({
        SourceImage: { Bytes: sourceBytes },
        TargetImage: { Bytes: targetBytes },
        SimilarityThreshold: this.faceMatchThreshold * 100, // AWS uses 0-100
      });

      const response = await this.rekognitionClient.send(command);

      if (!response.FaceMatches || response.FaceMatches.length === 0) {
        return {
          match: false,
          confidence: 0,
        };
      }

      const bestMatch = response.FaceMatches[0];
      const similarity = bestMatch.Similarity || 0;
      const confidence = similarity / 100; // Convert to 0-1

      return {
        match: confidence >= this.faceMatchThreshold,
        confidence,
        faceQuality: bestMatch.Face?.Quality?.Brightness,
      };
    } catch (error) {
      this.logger.error('AWS Rekognition CompareFaces failed', error.stack);
      throw new Error('Face comparison failed: ' + error.message);
    }
  }

  /**
   * Detect faces and assess liveness indicators
   */
  async detectFaceLiveness(imageBase64: string): Promise<LivenessResult> {
    if (!this.rekognitionClient) {
      throw new Error('AWS Rekognition not configured');
    }

    try {
      const imageBytes = this.base64ToBuffer(imageBase64);

      const command = new DetectFacesCommand({
        Image: { Bytes: imageBytes },
        Attributes: ['ALL'], // Include eyes open, mouth open, etc.
      });

      const response = await this.rekognitionClient.send(command);

      if (!response.FaceDetails || response.FaceDetails.length === 0) {
        return {
          livenessCheck: false,
          confidence: 0,
        };
      }

      const face: FaceDetail = response.FaceDetails[0];

      // Liveness indicators: eyes open, confidence
      const eyesOpen = face.EyesOpen?.Value === true;
      const eyesOpenConfidence = (face.EyesOpen?.Confidence || 0) / 100;
      const mouthClosed = face.MouthOpen?.Value === false;

      // Simple heuristic: eyes open with high confidence
      const livenessConfidence = eyesOpenConfidence;
      const livenessCheck = eyesOpen && livenessConfidence >= this.livenessThreshold;

      return {
        livenessCheck,
        confidence: livenessConfidence,
        eyesOpen,
        mouthOpen: face.MouthOpen?.Value,
      };
    } catch (error) {
      this.logger.error('AWS Rekognition DetectFaces failed', error.stack);
      throw new Error('Liveness detection failed: ' + error.message);
    }
  }

  /**
   * Extract face quality score from image
   */
  async assessFaceQuality(imageBase64: string): Promise<number> {
    if (!this.rekognitionClient) {
      throw new Error('AWS Rekognition not configured');
    }

    try {
      const imageBytes = this.base64ToBuffer(imageBase64);

      const command = new DetectFacesCommand({
        Image: { Bytes: imageBytes },
        Attributes: ['ALL'], // Changed from 'QUALITY' to 'ALL'
      });

      const response = await this.rekognitionClient.send(command);

      if (!response.FaceDetails || response.FaceDetails.length === 0) {
        return 0;
      }

      const quality = response.FaceDetails[0].Quality;
      const brightness = quality?.Brightness || 0;
      const sharpness = quality?.Sharpness || 0;

      // Simple quality score (0-1)
      return Math.min((brightness + sharpness) / 200, 1);
    } catch (error) {
      this.logger.error('AWS Rekognition quality assessment failed', error.stack);
      return 0;
    }
  }

  /**
   * Convert base64 or data URL to Buffer for AWS
   */
  private base64ToBuffer(base64String: string): Uint8Array {
    // Remove data URL prefix if present
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    return new Uint8Array(buffer);
  }

  /**
   * Check if AWS Rekognition is configured and available
   */
  isAvailable(): boolean {
    return this.rekognitionClient !== undefined;
  }
}
