const DEV = import.meta.env.DEV;

function pad(n: number) { return n < 10 ? '0' + n : '' + n; }

export function formatDate(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export function daysBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const s = new Date(y1, m1 - 1, d1);
  const e = new Date(y2, m2 - 1, d2);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export function toDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toStr(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function rangeDisplay(p: { start: string; end: string }): string {
  const start = toDate(p.start);
  const end = toDate(p.end);
  if (start.getTime() === end.getTime()) {
    return start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  const s = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const e = end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${s} – ${e}`;
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getDefaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export function monthToPeriod(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function normalizeDate(s: string): string {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-');
    const month = Number(parts[1]);
    if (month >= 1 && month <= 12) return s;
  }
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m && Number(m[1]) <= 31 && Number(m[2]) <= 12) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  const m3 = s.match(/^(\d{1,2})[.\/](\d{1,2})\s*-\s*(\d{1,2})[.\/](\d{1,2})$/);
  if (m3) {
    let y = new Date().getFullYear();
    const result = `${y}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`;
    const today = toStr(new Date());
    if (result > today) y--;
    return `${y}-${m3[2].padStart(2, '0')}-${m3[1].padStart(2, '0')}`;
  }
  if (DEV) console.warn('[dateUtils] normalizeDate: unrecognized format, returning as-is:', JSON.stringify(s));
  return s;
}


