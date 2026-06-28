import { normHeader } from './parseFile';
import type { ImportSource } from '../types';

const COLUMN_DICT: Record<string, string> = {
  'артикул продавца': 'sku',
  'артикул wb': 'wb_sku',
  'предмет': 'category',
  'категория': 'category',
  'дата': 'date',
  'показы': 'impressions',
  'переходы в карточку': 'clicks',
  'клики': 'clicks',
  'положили в корзину': 'carts',
  'заказали товаров, шт': 'orders',
  'заказали товаров шт': 'orders',
  'заказали на сумму': 'ordered_amount',
  'заказали на сумму, ₽': 'ordered_amount',
  'общая сумма заказов': 'ordered_amount',
  'заказали товаров, руб': 'ordered_amount',
  'заказали товаров руб': 'ordered_amount',
  'выкупили на сумму': 'buyout_amount',
  'выкупили на сумму, ₽': 'buyout_amount',
  'выкуплено товаров, шт': 'buyouts',
  'выкуплено товаров шт': 'buyouts',
  'выкуплено товаров, руб': 'buyout_amount',
  'выкуплено товаров руб': 'buyout_amount',
  'отменили на сумму': 'cancellation_amount',
  'отменили на сумму, ₽': 'cancellation_amount',
  'отменено товаров, шт': 'cancellations',
  'отменено товаров шт': 'cancellations',
  'выкупили, шт': 'buyouts',
  'отменили, шт': 'cancellations',
  // XWay / Реклама
  'рекламные показы': 'ad_impressions',
  'рекламные переходы': 'ad_clicks',
  'рекламные клики': 'ad_clicks',
  'рекламные заказы': 'ad_orders',
  'заказы, руб': 'ad_orders',
  'заказы, шт': 'orders',
  'рекламный расход': 'ad_spend',
  'расход': 'ad_spend',
  'расход, руб.': 'ad_spend',
  'расход, руб': 'ad_spend',
  'cpc, руб.': 'cpc',
  'cpo, руб.': 'cpo',
  'дрр, %': 'drr',
  // Рентабельность / План
  'остаток': 'stock',
  'сток': 'stock',
  'текущий остаток товара': 'stock',
  'план заказов': 'plan_orders',
  'прогнозная прибыль на товар': 'forecast_profit_per_order',
  'фактическая прибыль': 'actual_profit',
  'фактическая маржа': 'actual_margin',
  // Английские варианты
  'sku': 'sku',
  'article': 'sku',
  'nm_id': 'sku',
  'date': 'date',
  'day': 'date',
  'impressions': 'impressions',
  'views': 'impressions',
  'clicks': 'clicks',
  'carts': 'carts',
  'orders': 'orders',
  'buyouts': 'buyouts',
  'ordered amount': 'ordered_amount',
  'ordered_amount': 'ordered_amount',
  'buyout amount': 'buyout_amount',
  'buyout_amount': 'buyout_amount',
  'cancellations': 'cancellations',
  'cancellation amount': 'cancellation_amount',
  'cancellation_amount': 'cancellation_amount',
  'ad impressions': 'ad_impressions',
  'ad_impressions': 'ad_impressions',
  'ad clicks': 'ad_clicks',
  'ad_clicks': 'ad_clicks',
  'ad orders': 'ad_orders',
  'ad_orders': 'ad_orders',
  'ad spend': 'ad_spend',
  'ad_spend': 'ad_spend',
  'spend': 'ad_spend',
  'stock': 'stock',
  'plan orders': 'plan_orders',
  'plan_orders': 'plan_orders',
  'forecast profit': 'forecast_profit_per_order',
  'forecast_profit_per_order': 'forecast_profit_per_order',
  'actual profit': 'actual_profit',
  'actual_profit': 'actual_profit',
  'actual margin': 'actual_margin',
  'actual_margin': 'actual_margin',
};

const DICT: Record<string, string> = {};
for (const [key, val] of Object.entries(COLUMN_DICT)) {
  DICT[normHeader(key)] = val;
}

// XWay-specific overrides (key = normalized header, value = field)
const XWAY_OVERRIDES: Record<string, string> = {
  'показы': 'ad_impressions',
  'клики': 'ad_clicks',
  'заказы, руб': 'ad_orders',
  'заказы, шт': 'xway_orders_qty',
};

export const FIELD_LABELS: Record<string, string> = {
  sku: 'Артикул (SKU)',
  date: 'Дата',
  wb_sku: 'Артикул WB',
  category: 'Категория',
  impressions: 'Показы',
  clicks: 'Клики',
  carts: 'Корзины',
  orders: 'Заказы',
  buyouts: 'Выкупы',
  cancellations: 'Отмены',
  ordered_amount: 'Сумма заказов',
  buyout_amount: 'Сумма выкупов',
  cancellation_amount: 'Сумма отмен',
  ad_impressions: 'Рекламные показы',
  ad_clicks: 'Рекламные клики',
  ad_orders: 'Рекламные заказы',
  ad_spend: 'Расход на рекламу',
  stock: 'Остаток',
  plan_orders: 'План заказов',
  forecast_profit_per_order: 'Прогноз прибыли',
  actual_profit: 'Факт. прибыль',
  actual_margin: 'Факт. маржа',
  cpc: 'CPC, руб.',
  cpo: 'CPO, руб.',
  drr: 'ДРР, %',
};

export function getRequiredFields(source?: ImportSource): string[] {
  return source === 'xway' ? ['sku'] : ['sku', 'date'];
}

export interface ColumnMapping {
  map: Record<string, string>;
  unmapped: string[];
  missing: string[];
}

export function detectSourceFromHeaders(headers: string[]): ImportSource | null {
  const nhs = headers.map(h => normHeader(h));

  // Profitability: себестоимость, валовая прибыль, рентабельность
  const profitKeys = ['себестоимость', 'валоваяприбыль', 'валоваярентабельность', 'ценапродажи', 'ценозакупки'];
  if (profitKeys.some(k => nhs.some(nh => nh.includes(k) || k.includes(nh)))) return 'profitability';

  // XWAY: расход + дрр, or ad-specific indicators
  const hasAdSpend = nhs.some(nh => ['расход', 'расход, руб', 'расход, руб.', 'расходруб'].includes(nh));
  const hasDrr = nhs.some(nh => ['дрр', 'дрр, %', 'общийдрр'].includes(nh));
  const hasAdOrders = nhs.some(nh => ['заказы, руб', 'заказыруб', 'ad orders', 'ad_orders'].includes(nh));
  if (hasAdOrders || (hasAdSpend && hasDrr)) return 'xway';

  // WB funnel: показы + клики + заказалитоваров (без ad-признаков)
  const hasImpressions = nhs.some(nh => nh === 'показы');
  const hasClicks = nhs.some(nh => nh === 'клики' || nh === 'переходывкарточку');
  const hasOrders = nhs.some(nh => nh.includes('заказали') || nh.includes('заказышт') || nh === 'заказы');
  if (hasImpressions && hasClicks && hasOrders) return 'wb_funnel';

  return null;
}

export function lookupField(header: string): string | null {
  const nh = normHeader(header);
  return DICT[nh] || null;
}

export function autoDetectMapping(headers: string[], source?: ImportSource): ColumnMapping {
  const map: Record<string, string> = {};
  const unmapped: string[] = [];

  console.log('[cMap] autoDetectMapping source:', source, 'headers:', headers);

  for (const h of headers) {
    const nh = normHeader(h);
    const dictField = DICT[nh];
    const override = source === 'xway' ? XWAY_OVERRIDES[nh] : undefined;
    const field = override || dictField;
    if (field) {
      map[h] = field;
      console.log('[cMap]  mapped:', JSON.stringify(h), '->', JSON.stringify(nh), '->', field, override ? '(xway override)' : '');
    } else {
      unmapped.push(h);
      console.log('[cMap]  UNMAPPED:', JSON.stringify(h), '->', JSON.stringify(nh));
    }
  }

  if (unmapped.length > 0) {
    console.log('[cMap] unrecognized columns:', unmapped.join(', '));
  } else {
    console.log('[cMap] all columns mapped:', Object.entries(map).map(([h, f]) => `${h}→${f}`).join(', '));
  }

  const found = new Set(Object.values(map));
  const missing = getRequiredFields(source).filter(f => !found.has(f));
  if (missing.length > 0) console.log('[cMap] missing required fields:', missing);

  return { map, unmapped, missing };
}

export function remapRows(rows: Record<string, string>[], mapping: Record<string, string>): Record<string, string>[] {
  const result = rows.map(row => {
    const remapped: Record<string, string> = {};
    for (const [origHeader, rawVal] of Object.entries(row)) {
      const field = mapping[origHeader];
      if (field) remapped[field] = rawVal;
    }
    return remapped;
  });
  if (result.length > 0) {
    console.log('[cMap] remapRows — first remapped row keys:', Object.keys(result[0]), 'values:', result[0]);
  }
  return result;
}
