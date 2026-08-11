import type { GeographyOrderRecord } from '../types';

export const UNKNOWN_GEO_AREA = 'Без региона';
export const UNKNOWN_GEO_CITY = 'Без населённого пункта';

export function normalizeGeoArea(value: string | null | undefined) {
  return String(value || '').trim() || UNKNOWN_GEO_AREA;
}

export function normalizeGeoCity(value: string | null | undefined) {
  return String(value || '').trim() || UNKNOWN_GEO_CITY;
}

export function hasKnownGeoArea(value: string | null | undefined) {
  return normalizeGeoArea(value) !== UNKNOWN_GEO_AREA;
}

export function hasKnownGeoCity(value: string | null | undefined) {
  return normalizeGeoCity(value) !== UNKNOWN_GEO_CITY;
}

function baseKey(record: GeographyOrderRecord) {
  return `${record.date}|${record.product_id}|${record.region}`;
}

function areaKey(record: GeographyOrderRecord) {
  return `${baseKey(record)}|${normalizeGeoArea(record.area)}`;
}

function exactKey(record: GeographyOrderRecord) {
  return `${areaKey(record)}|${normalizeGeoCity(record.city)}`;
}

export function selectDetailedGeographyRows(records: GeographyOrderRecord[]) {
  const normalizedByKey = new Map<string, GeographyOrderRecord>();

  records.forEach(record => {
    const normalized = {
      ...record,
      area: normalizeGeoArea(record.area),
      city: normalizeGeoCity(record.city),
    };
    normalizedByKey.set(exactKey(normalized), normalized);
  });

  const normalized = [...normalizedByKey.values()];
  const basesWithKnownAreas = new Set(normalized.filter(record => hasKnownGeoArea(record.area)).map(baseKey));
  const areasWithKnownCities = new Set(normalized.filter(record => hasKnownGeoCity(record.city)).map(areaKey));

  return normalized.filter(record => {
    if (!hasKnownGeoArea(record.area) && basesWithKnownAreas.has(baseKey(record))) return false;
    if (!hasKnownGeoCity(record.city) && areasWithKnownCities.has(areaKey(record))) return false;
    return true;
  });
}
