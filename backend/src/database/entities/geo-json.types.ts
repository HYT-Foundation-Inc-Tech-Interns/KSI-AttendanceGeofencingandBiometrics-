/**
 * GeoJSON shapes for the PostGIS `geography` columns.
 *
 * These columns are NOT plain strings. TypeORM selects them as
 * `ST_AsGeoJSON(col)::json` and writes them as `ST_GeomFromGeoJSON($n)`, so the
 * value that round-trips through an entity is always a GeoJSON object.
 *
 * Passing WKT such as `POINT(120.98 14.59)` to a write makes PostGIS fail with
 * `unknown GeoJSON type`, because the driver JSON-stringifies the value first
 * and then hands PostGIS a JSON *string* rather than a geometry object.
 */

export interface GeoJsonPoint {
  type: 'Point';
  /** [longitude, latitude] — GeoJSON is x/y, so longitude comes first. */
  coordinates: [number, number];
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Array of linear rings; each ring is an array of [longitude, latitude] pairs. */
  coordinates: [number, number][][];
}

/** Convert a longitude/latitude pair into a GeoJSON Point. */
export function toGeoJsonPoint(longitude: number, latitude: number): GeoJsonPoint {
  return { type: 'Point', coordinates: [longitude, latitude] };
}
