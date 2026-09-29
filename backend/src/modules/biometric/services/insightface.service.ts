import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FaceComparisonResult, LivenessResult } from './aws-rekognition.service';

interface InsightFaceCompareRequest {
  image1: string; // Base64 image
  image2: string; // Base64 image
}

interface InsightFaceCompareResponse {
  similarity: number; // 0-1
  confidence: number;
  match: boolean;
  threshold: number;
}

interface InsightFaceDetectRequest {
  image: string; // Base64 image
}

interface InsightFaceDetectResponse {
  faces: Array<{
    quality: number;
    bbox: [number, number, number, number];
    landmarks: number[][];
  }>;
}

/**
 * Self-hosted face matching service (InsightFace/ArcFace)
 * Alternative to AWS Rekognition for cost savings or offline deployment
 */
@Injectable()
export class InsightFaceService {
  private readonly logger = new Logger(InsightFaceService.name);
  private serviceUrl: string;
  private apiKey: string;
  private faceMatchThreshold: number;
  private isConfigured: boolean;

  constructor(private configService: ConfigService) {
    this.serviceUrl = this.configService.get<string>('FACE_MATCH_SERVICE_URL', '');
    this.apiKey = this.configService.get<string>('FACE_MATCH_API_KEY', '');
    this.faceMatchThreshold = parseFloat(
      this.configService.get<string>('FACE_MATCH_THRESHOLD', '0.85'),
    );

    this.isConfigured = this.serviceUrl.length > 0;

    if (this.isConfigured) {
      this.logger.log(`InsightFace service configured at: ${this.serviceUrl}`);
    } else {
      this.logger.warn('InsightFace service not configured');
    }
  }

  /**
   * Compare two face images using self-hosted InsightFace service
   */
  async compareFaces(
    sourceImageBase64: string,
    targetImageBase64: string,
  ): Promise<FaceComparisonResult> {
    if (!this.isConfigured) {
      throw new Error('InsightFace service not configured');
    }

    try {
      const payload: InsightFaceCompareRequest = {
        image1: this.stripDataUrlPrefix(sourceImageBase64),
        image2: this.stripDataUrlPrefix(targetImageBase64),
      };

      const response = await fetch(`${this.serviceUrl}/compare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`InsightFace API error: ${response.statusText}`);
      }

      const result: InsightFaceCompareResponse = await response.json();

      return {
        match: result.similarity >= this.faceMatchThreshold,
        confidence: result.similarity,
      };
    } catch (error) {
      this.logger.error('InsightFace compareFaces failed', error.stack);
      throw new Error('Face comparison failed: ' + error.message);
    }
  }

  /**
   * Detect faces and assess quality
   * Note: InsightFace doesn't have built-in liveness, this only checks face presence/quality
   */
  async detectFaceLiveness(imageBase64: string): Promise<LivenessResult> {
    if (!this.isConfigured) {
      throw new Error('InsightFace service not configured');
    }

    try {
      const payload: InsightFaceDetectRequest = {
        image: this.stripDataUrlPrefix(imageBase64),
      };

      const response = await fetch(`${this.serviceUrl}/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`InsightFace API error: ${response.statusText}`);
      }

      const result: InsightFaceDetectResponse = await response.json();

      if (!result.faces || result.faces.length === 0) {
        return {
          livenessCheck: false,
          confidence: 0,
        };
      }

      // InsightFace doesn't have true liveness detection
      // We use face quality as a proxy (higher quality = more likely to be real)
      const faceQuality = result.faces[0].quality || 0;
      const livenessCheck = faceQuality >= 0.6; // Heuristic threshold

      return {
        livenessCheck,
        confidence: faceQuality,
      };
    } catch (error) {
      this.logger.error('InsightFace detectFaceLiveness failed', error.stack);
      throw new Error('Face detection failed: ' + error.message);
    }
  }

  /**
   * Assess face quality using self-hosted service
   */
  async assessFaceQuality(imageBase64: string): Promise<number> {
    if (!this.isConfigured) {
      throw new Error('InsightFace service not configured');
    }

    try {
      const payload: InsightFaceDetectRequest = {
        image: this.stripDataUrlPrefix(imageBase64),
      };

      const response = await fetch(`${this.serviceUrl}/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`InsightFace API error: ${response.statusText}`);
      }

      const result: InsightFaceDetectResponse = await response.json();

      if (!result.faces || result.faces.length === 0) {
        return 0;
      }

      return result.faces[0].quality || 0.5;
    } catch (error) {
      this.logger.error('InsightFace quality assessment failed', error.stack);
      return 0.5; // Default quality score
    }
  }

  /**
   * Strip data URL prefix from base64 string
   */
  private stripDataUrlPrefix(base64String: string): string {
    return base64String.replace(/^data:image\/\w+;base64,/, '');
  }

  /**
   * Check if InsightFace service is configured and available
   */
  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Health check for InsightFace service
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const response = await fetch(`${this.serviceUrl}/health`, {
        method: 'GET',
        headers: {
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
      });

      return response.ok;
    } catch (error) {
      this.logger.error('InsightFace health check failed', error);
      return false;
    }
  }
}
