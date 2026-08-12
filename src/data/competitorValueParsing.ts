export type CompetitorCell = string | number | boolean | Date | null | undefined;

export function competitorCellText(value: CompetitorCell): string {
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').replace(/\r/g, ' ').trim();
}

export function competitorNumber(value: CompetitorCell): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const compact = competitorCellText(value)
    .replace(/₽/g, '')
    .replace(/\bр\.?/gi, '')
    .replace(/[%\s\u00a0\u202f]/g, '')
    .replace(/[^\d,.-]/g, '');
  if (!compact) return 0;

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if ((compact.match(/,/g) || []).length > 1) {
    normalized = compact.replace(/,/g, '');
  } else if ((compact.match(/\./g) || []).length > 1) {
    normalized = compact.replace(/\./g, '');
  } else if (lastComma >= 0) {
    normalized = compact.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function competitorPercent(value: CompetitorCell): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.abs(value) <= 1 ? value * 100 : value;
  }
  return competitorNumber(value);
}
