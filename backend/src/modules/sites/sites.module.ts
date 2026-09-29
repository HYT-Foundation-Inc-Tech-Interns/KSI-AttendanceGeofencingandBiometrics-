import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SitesService } from './sites.service';
import { SitesController } from './sites.controller';
import { Site } from '../../database/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Site])],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
