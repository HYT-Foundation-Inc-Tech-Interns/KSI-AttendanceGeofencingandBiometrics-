import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Site,
  SiteStatus,
  GeoJsonPoint,
  GeoJsonPolygon,
  toGeoJsonPoint,
} from '../../database/entities';
import { CreateSiteDto, UpdateSiteDto, GeofenceValidationDto } from './dto/create-site.dto';

@Injectable()
export class SitesService {
  constructor(
    @InjectRepository(Site)
    private siteRepository: Repository<Site>,
  ) {}

  async create(organizationId: string, createSiteDto: CreateSiteDto): Promise<Site> {
    const { hasCircular, hasPolygon } = this.describeGeofence(createSiteDto);

    // Validate that either circular OR polygon geofence is provided
    if (!hasCircular && !hasPolygon) {
      throw new BadRequestException('Either circular or polygon geofence must be provided');
    }

    const site = this.siteRepository.create({
      organizationId,
      name: createSiteDto.name,
      address: createSiteDto.address,
      timezone: createSiteDto.timezone || 'Asia/Manila',
      status: (createSiteDto.status as SiteStatus) || SiteStatus.ACTIVE,
      geofenceCenter: hasCircular
        ? this.toPointGeoJson(createSiteDto.geofenceCenterLng!, createSiteDto.geofenceCenterLat!)
        : null,
      geofenceRadiusM: hasCircular ? createSiteDto.geofenceRadiusM! : null,
      geofencePolygon: hasPolygon ? this.toPolygonGeoJson(createSiteDto.geofencePolygon!) : null,
    });

    // A single insert: the `geofence_required` CHECK constraint rejects a site
    // that is saved before its geofence is attached.
    const savedSite = await this.siteRepository.save(site);

    return this.findOne(savedSite.id, organizationId);
  }

  /** Which geofence shapes a payload is asking for. */
  private describeGeofence(dto: CreateSiteDto | UpdateSiteDto) {
    const hasCircular =
      dto.geofenceCenterLat !== undefined &&
      dto.geofenceCenterLng !== undefined &&
      dto.geofenceRadiusM !== undefined;
    const hasPolygon = Array.isArray(dto.geofencePolygon) && dto.geofencePolygon.length > 0;
    return { hasCircular, hasPolygon };
  }

  private toPointGeoJson(longitude: number, latitude: number): GeoJsonPoint {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new BadRequestException('geofenceCenterLat and geofenceCenterLng must be numbers');
    }
    if (latitude < -90 || latitude > 90) {
      throw new BadRequestException('geofenceCenterLat must be between -90 and 90');
    }
    if (longitude < -180 || longitude > 180) {
      throw new BadRequestException('geofenceCenterLng must be between -180 and 180');
    }
    return toGeoJsonPoint(longitude, latitude);
  }

  private toPolygonGeoJson(coordinates: number[][]): GeoJsonPolygon {
    const ring: [number, number][] = coordinates.map((pair) => {
      const [longitude, latitude] = pair ?? [];
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw new BadRequestException('geofencePolygon must be an array of [longitude, latitude] pairs');
      }
      if (latitude < -90 || latitude > 90) {
        throw new BadRequestException('geofencePolygon latitude must be between -90 and 90');
      }
      if (longitude < -180 || longitude > 180) {
        throw new BadRequestException('geofencePolygon longitude must be between -180 and 180');
      }
      return [longitude, latitude];
    });

    if (ring.length < 3) {
      throw new BadRequestException('geofencePolygon must contain at least 3 coordinate pairs');
    }

    // GeoJSON requires the linear ring to be closed (first point === last point).
    const [firstLng, firstLat] = ring[0];
    const [lastLng, lastLat] = ring[ring.length - 1];
    if (firstLng !== lastLng || firstLat !== lastLat) {
      ring.push([firstLng, firstLat]);
    }

    return { type: 'Polygon', coordinates: [ring] };
  }

  async findAll(organizationId: string): Promise<Site[]> {
    return this.siteRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, organizationId: string): Promise<Site> {
    const site = await this.siteRepository.findOne({
      where: { id, organizationId },
    });

    if (!site) {
      throw new NotFoundException(`Site with ID ${id} not found`);
    }

    return site;
  }

  async update(id: string, organizationId: string, updateSiteDto: UpdateSiteDto): Promise<Site> {
    const site = await this.findOne(id, organizationId);

    // Update basic fields
    if (updateSiteDto.name !== undefined) site.name = updateSiteDto.name;
    if (updateSiteDto.address !== undefined) site.address = updateSiteDto.address;
    if (updateSiteDto.timezone !== undefined) site.timezone = updateSiteDto.timezone;
    if (updateSiteDto.status !== undefined) site.status = updateSiteDto.status as SiteStatus;

    const { hasCircular, hasPolygon } = this.describeGeofence(updateSiteDto);

    if (hasCircular) {
      site.geofenceCenter = this.toPointGeoJson(
        updateSiteDto.geofenceCenterLng!,
        updateSiteDto.geofenceCenterLat!,
      );
      site.geofenceRadiusM = updateSiteDto.geofenceRadiusM!;
    }

    if (hasPolygon) {
      site.geofencePolygon = this.toPolygonGeoJson(updateSiteDto.geofencePolygon!);
    }

    // `geofenceCenter`/`geofencePolygon` were hydrated from PostGIS as GeoJSON
    // objects, so saving them back round-trips correctly.
    await this.siteRepository.save(site);

    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const site = await this.findOne(id, organizationId);
    await this.siteRepository.remove(site);
  }

  /**
   * Validate if a GPS point is within a site's geofence
   * Server-authoritative validation (never trust client)
   */
  async validateGeofence(
    siteId: string,
    organizationId: string,
    validationDto: GeofenceValidationDto,
  ): Promise<{ withinGeofence: boolean; distance?: number }> {
    const site = await this.findOne(siteId, organizationId);

    const { latitude, longitude } = validationDto;

    // Try circular geofence first.
    // Both sides of ST_DWithin must be `geography`, otherwise the radius is
    // interpreted in degrees of the raw SRID 4326 coordinates (1 degree ≈ 111 km),
    // which would make a 100 m geofence accept points thousands of km away.
    if (site.geofenceCenter && site.geofenceRadiusM) {
      const result = await this.siteRepository.query(
        `
        SELECT
          ST_DWithin(
            geofence_center,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            geofence_radius_m
          ) as within_geofence,
          ST_Distance(
            geofence_center,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) as distance
        FROM sites
        WHERE id = $3 AND geofence_center IS NOT NULL
        `,
        [longitude, latitude, siteId],
      );

      if (result && result.length > 0) {
        return {
          withinGeofence: result[0].within_geofence,
          distance: Math.round(Number(result[0].distance)),
        };
      }
    }

    // Try polygon geofence
    if (site.geofencePolygon) {
      const result = await this.siteRepository.query(
        `
        SELECT
          ST_Contains(
            geofence_polygon::geometry,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geometry
          ) as within_geofence
        FROM sites
        WHERE id = $3 AND geofence_polygon IS NOT NULL
        `,
        [longitude, latitude, siteId],
      );

      if (result && result.length > 0) {
        return {
          withinGeofence: result[0].within_geofence,
        };
      }
    }

    // No geofence configured
    throw new BadRequestException('Site has no geofence configured');
  }

  /**
   * Get geofence data for client-side display (UX only, server still validates)
   */
  async getGeofenceData(siteId: string, organizationId: string) {
    const site = await this.findOne(siteId, organizationId);

    const response: any = {
      site_id: site.id,
      site_name: site.name,
      timezone: site.timezone,
    };

    // Circular geofence — already hydrated as a GeoJSON Point by TypeORM
    // (it selects `ST_AsGeoJSON(geofence_center)::json`)
    if (site.geofenceCenter) {
      const [longitude, latitude] = site.geofenceCenter.coordinates;
      response.geofence_center = { latitude, longitude };
      response.geofence_radius_m = site.geofenceRadiusM;
    }

    // Polygon geofence — already a GeoJSON Polygon
    if (site.geofencePolygon) {
      response.geofence_polygon = site.geofencePolygon;
    }

    return response;
  }
}
