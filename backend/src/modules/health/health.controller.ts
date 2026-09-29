import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is operational' })
  async check() {
    const timestamp = new Date().toISOString();
    
    // Check database connection
    let databaseStatus: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      databaseStatus = 'up';
    } catch (error) {
      // Database is down
    }

    const status = databaseStatus === 'up' ? 'ok' : 'degraded';

    return {
      status,
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: databaseStatus,
      },
    };
  }
}
