import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BiometricController } from './biometric.controller';
import { BiometricService } from './biometric.service';
import { AwsRekognitionService } from './services/aws-rekognition.service';
import { InsightFaceService } from './services/insightface.service';
import { Employee, DeviceEnrollment } from '../../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Employee, DeviceEnrollment]), ConfigModule],
  controllers: [BiometricController],
  providers: [BiometricService, AwsRekognitionService, InsightFaceService],
  exports: [BiometricService], // Export for use in attendance module
})
export class BiometricModule {}
