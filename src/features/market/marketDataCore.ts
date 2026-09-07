import type { MarketDynamicsRecord } from '../../types';

export interface V5MarketBounds {
  minDate: string | null;
  maxDate: string | null;
  dayCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: сервер вернул неожиданный ответ`);
  }
  return value as Record<string, unknown>;
}

function readDate(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new Error(`V5 «Рынок»: некорректное поле ${field}`);
  }
  return value;
}

function readNumber(value: unknown, field: string, nullable = false): number {
  if (nullable && value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`V5 «Рынок»: некорректное поле ${field}`);
  return parsed;
}

export function parseV5MarketBounds(value: unknown): V5MarketBounds {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return { minDate: null, maxDate: null, dayCount: 0 };
  const record = asRecord(row, 'Границы данных «Рынка»');
  const minDate = readDate(record.min_date, 'min_date', true);
  const maxDate = readDate(record.max_date, 'max_date', true);
  const dayCount = readNumber(record.day_count, 'day_count');

  if (!Number.isInteger(dayCount) || dayCount < 0) throw new Error('V5 «Рынок»: некорректное количество дней');
  if ((minDate === null) !== (maxDate === null) || (dayCount === 0) !== (minDate === null)) {
    throw new Error('V5 «Рынок»: границы периода не согласованы с количеством дней');
  }
  if (minDate && maxDate && minDate > maxDate) throw new Error('V5 «Рынок»: начало периода позже окончания');

  return { minDate, maxDate, dayCount };
}

export function mapV5MarketSeries(value: unknown): MarketDynamicsRecord[] {
  if (!Array.isArray(value)) throw new Error('Ряд V5 «Рынок»: сервер вернул неожиданный ответ');

  return value.map((item, index) => {
    const row = asRecord(item, `Ряд V5 «Рынок», строка ${index + 1}`);
    return {
      date: readDate(row.period_date, 'period_date') as string,
      market_ordered_amount: readNumber(row.market_ordered_amount, 'market_ordered_amount'),
      own_ordered_amount: readNumber(row.own_ordered_amount, 'own_ordered_amount'),
      amount_share: readNumber(row.amount_share, 'amount_share', true),
      market_orders: readNumber(row.market_orders, 'market_orders'),
      own_orders: readNumber(row.own_orders, 'own_orders'),
      orders_share: readNumber(row.orders_share, 'orders_share', true),
      own_avg_check: readNumber(row.own_avg_check, 'own_avg_check', true),
      market_avg_check: readNumber(row.market_avg_check, 'market_avg_check', true),
    };
  });
}

export function assertV5MarketRange(bounds: V5MarketBounds): void {
  if (!bounds.minDate || !bounds.maxDate) return;
  const days = Math.round((Date.parse(`${bounds.maxDate}T00:00:00Z`) - Date.parse(`${bounds.minDate}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 1_827) throw new Error('V5 «Рынок»: общий период превышает серверный лимит в пять лет');
}
