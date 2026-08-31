import { normHeader } from './parseFile';
import type { ImportSource } from '../types';

const COLUMN_DICT: Record<string, string> = {
  'артикул': 'sku',
  'артикул продавца': 'sku',
  'nm_id': 'wb_sku',
  'nm': 'wb_sku',
  'name': 'name',
  'product name': 'name',
  'brand': 'brand',
  'cabinet': 'cabinet',
  'артикул wb': 'wb_sku',
  'артикул (wb)': 'wb_sku',
  'предмет': 'category',
  'категория': 'category',
  'дата': 'date',
  'начало периода': 'period_start',
  'дата начала': 'period_start',
  'период с': 'period_start',
  'конец периода': 'period_end',
  'дата окончания': 'period_end',
  'период по': 'period_end',
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
  'себестоимость': 'cost',
  'агентское вознаграждение': 'agent_fee',
  'стоимость логистики': 'logistics_cost',
  'сумма рекламы': 'marketing_cost',
  'сумма хранения': 'storage_cost',
  // Рентабельность / План
  'остаток': 'stock',
  'сток': 'stock',
  'текущий остаток товара': 'stock',
  'план заказов': 'plan_orders',
  'прогнозная прибыль на товар': 'forecast_profit_per_order',
  'фактическая прибыль': 'actual_profit',
  'фактическая маржа': 'actual_margin',
  'выручка': 'profit_revenue',
  'валоваяприбыльсучетомрасходовмаркетплейса': 'actual_profit',
  'итоговая маржинальность,%': 'actual_margin',
  // Английские варианты
  'sku': 'sku',
  'article': 'sku',
  'date': 'date',
  'day': 'date',
  'period start': 'period_start',
  'period_start': 'period_start',
  'start date': 'period_start',
  'period end': 'period_end',
  'period_end': 'period_end',
  'end date': 'period_end',
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
DICT['\u043d\u0430\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043d\u0438\u0435'] = 'name';
DICT['\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0442\u043e\u0432\u0430\u0440\u0430'] = 'name';
DICT['\u0431\u0440\u0435\u043d\u0434'] = 'brand';
DICT['\u043a\u0430\u0431\u0438\u043d\u0435\u0442'] = 'cabinet';
DICT['\u0440\u0435\u0433\u0438\u043e\u043d'] = 'region';
DICT['\u043a\u043b\u0430\u0441\u0442\u0435\u0440'] = 'region';
DICT['\u043e\u0431\u043b\u0430\u0441\u0442\u044c'] = 'area';
DICT['\u0433\u043e\u0440\u043e\u0434'] = 'city';
DICT['\u0432\u0440\u0435\u043c\u044f \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0438'] = 'delivery_time';
DICT['\u0438\u0442\u043e\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u0448\u0442'] = 'geo_orders_total';
DICT['\u0438\u0442\u043e\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043f\u043e \u0442\u043e\u0432\u0430\u0440\u0430\u043c \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_product_local_orders';
DICT['\u0438\u0442\u043e\u0433\u043e \u0437\u0430\u043a\u0430\u0437\u043e\u0432 \u043f\u043e \u0442\u043e\u0432\u0430\u0440\u0430\u043c \u043d\u0435 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_product_nonlocal_orders';
DICT['\u0437\u0430\u043a\u0430\u0437\u044b \u0441\u043e \u0441\u043a\u043b\u0430\u0434\u0430 wb \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_wb_local_orders';
DICT['\u0437\u0430\u043a\u0430\u0437\u044b \u0441\u043e \u0441\u043a\u043b\u0430\u0434\u0430 wb \u043d\u0435 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_wb_nonlocal_orders';
DICT['\u0437\u0430\u043a\u0430\u0437\u044b \u043c\u0430\u0440\u043a\u0435\u0442\u043f\u043b\u0435\u0439\u0441 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_mp_local_orders';
DICT['\u0437\u0430\u043a\u0430\u0437\u044b \u043c\u0430\u0440\u043a\u0435\u0442\u043f\u043b\u0435\u0439\u0441 \u043d\u0435 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0448\u0442'] = 'geo_mp_nonlocal_orders';
DICT['\u043e\u0441\u0442\u0430\u0442\u043a\u0438 \u0441\u043a\u043b\u0430\u0434 wb \u0448\u0442'] = 'geo_stock_wb';
DICT['\u043e\u0441\u0442\u0430\u0442\u043a\u0438 \u043c\u043f \u0448\u0442'] = 'geo_stock_mp';
DICT['\u0440\u0430\u0437\u0434\u0435\u043b'] = 'entry_section';
DICT['\u0442\u043e\u0447\u043a\u0430 \u0432\u0445\u043e\u0434\u0430'] = 'entry_point';
DICT['\u043f\u0435\u0440\u0435\u0445\u043e\u0434\u044b \u0432 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443'] = 'entry_clicks';
DICT['\u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443'] = 'entry_carts';
DICT['\u0437\u0430\u043a\u0430\u0437\u044b'] = 'entry_orders';
DICT['\u043f\u043e\u043a\u0430\u0437\u044b'] = 'entry_impressions';
DICT['\u0441\u043a\u043b\u0435\u0439\u043a\u0430'] = 'group_code';

Object.assign(DICT, {
  'продавцы': 'niche_sellers',
  'продавцы с заказами': 'niche_active_sellers',
  'продавцы с заказами предыдущий период': 'niche_active_sellers_previous',
  'монополизация %': 'niche_monopolization',
  'монополизация % предыдущий период': 'niche_monopolization_previous',
  'выручка ₽': 'niche_revenue',
  'выручка предыдущий период ₽': 'niche_revenue_previous',
  'средний чек ₽': 'niche_avg_check',
  'средний чек предыдущий период ₽': 'niche_avg_check_previous',
  'карточек товара': 'niche_product_cards',
  'карточек товара с заказами': 'niche_active_product_cards',
  'карточек с заказами предыдущий период': 'niche_active_product_cards_previous',
  'карточек товара с заказами %': 'niche_active_product_cards_share',
  'оборачиваемость за неделю дни': 'niche_weekly_turnover_days',
  'доступность': 'niche_availability',
  'среднее количество остатков шт': 'niche_avg_stock',
  'процент выкупа': 'niche_buyout_rate',
  'процент выкупа предыдущий период': 'niche_buyout_rate_previous',
  'средний рейтинг': 'niche_avg_rating',
  'поисковый запрос': 'search_query',
  'количество запросов': 'search_requests',
  'количество запросов предыдущий период': 'search_requests_previous',
  'запросов в среднем за день': 'search_avg_daily',
  'запросов в среднем за день предыдущий период': 'search_avg_daily_previous',
  'больше всего заказов в предмете': 'search_category',
  'перешли в карточку товара': 'search_card_clicks',
  'перешли в карточку товара предыдущий период': 'search_card_clicks_previous',
  'добавили в корзину': 'search_carts',
  'добавили в корзину предыдущий период': 'search_carts_previous',
  'конверсия в корзину': 'search_cart_conversion',
  'конверсия в корзину предыдущий период': 'search_cart_conversion_previous',
  'заказали товаров': 'search_orders',
  'заказали товаров предыдущий период': 'search_orders_previous',
  'конверсия в заказ': 'search_order_conversion',
  'конверсия в заказ предыдущий период': 'search_order_conversion_previous',
  'предметов с заказами по запросу': 'search_ordered_subjects',
  'предметов с заказами по запросу предыдущий период': 'search_ordered_subjects_previous',
  'количество товаров': 'search_products',
  'количество товаров предыдущий период': 'search_products_previous',
});

function compactHeader(value: string) {
  return normHeader(value).replace(/[^\p{L}\p{N}]/gu, '');
}

const PROFITABILITY_HEADERS: Array<[string, string]> = [
  ['\u0432\u0430\u043b\u043e\u0432\u0430\u044f\u043f\u0440\u0438\u0431\u044b\u043b\u044c\u0441\u0443\u0447\u0435\u0442\u043e\u043c\u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432\u043c\u0430\u0440\u043a\u0435\u0442\u043f\u043b\u0435\u0439\u0441\u0430', 'actual_profit'],
  ['\u0438\u0442\u043e\u0433\u043e\u0432\u0430\u044f\u043c\u0430\u0440\u0436\u0438\u043d\u0430\u043b\u044c\u043d\u043e\u0441\u0442\u044c', 'actual_margin'],
  ['\u0432\u044b\u0440\u0443\u0447\u043a\u0430', 'profit_revenue'],
  ['\u0441\u0435\u0431\u0435\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c', 'cost'],
  ['\u0430\u0433\u0435\u043d\u0442\u0441\u043a\u043e\u0435\u0432\u043e\u0437\u043d\u0430\u0433\u0440\u0430\u0436\u0434\u0435\u043d\u0438\u0435', 'agent_fee'],
  ['\u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c\u043b\u043e\u0433\u0438\u0441\u0442\u0438\u043a\u0438', 'logistics_cost'],
  ['\u0441\u0443\u043c\u043c\u0430\u0440\u0435\u043a\u043b\u0430\u043c\u044b', 'marketing_cost'],
  ['\u0441\u0443\u043c\u043c\u0430\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u044f', 'storage_cost'],
];

function lookupProfitabilityField(header: string): string | null {
  const compact = compactHeader(header);
  for (const [pattern, field] of PROFITABILITY_HEADERS) {
    if (compact === pattern || compact.includes(pattern)) return field;
  }
  return null;
}

const COMPACT_DICT: Record<string, string> = {};
for (const [header, field] of Object.entries(DICT)) COMPACT_DICT[compactHeader(header)] = field;

// XWay-specific overrides (key = normalized header, value = field)
const XWAY_OVERRIDES: Record<string, string> = {
  'показы': 'ad_impressions',
  'клики': 'ad_clicks',
  'заказы, руб': 'ad_orders',
  'заказы, шт': 'xway_orders_qty',
};

export const FIELD_LABELS: Record<string, string> = {
  review_cabinet: 'Кабинет', review_id: 'ID отзыва', review_rating: 'Количество звёзд', review_brand: 'Бренд из отчёта',
  review_text: 'Текст отзыва', review_advantages: 'Достоинства', review_disadvantages: 'Недостатки', review_author: 'Имя',
  review_country: 'Страна / регион', review_color: 'Цвет', review_size: 'Размер', review_helpful_down: 'Минусы полезности',
  review_helpful_up: 'Плюсы полезности', review_barcode: 'Штрихкод', review_response: 'Ответ продавца',
  review_initial_id: 'ID начального отзыва', review_additional_id: 'ID дополнительного отзыва',
  sku: 'Артикул (SKU)',
  date: 'Дата',
  period_start: 'Начало периода',
  period_end: 'Конец периода',
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
  profit_revenue: 'Выручка (Сойка)',
  agent_fee: 'Агентское вознаграждение',
  logistics_cost: 'Стоимость логистики',
  marketing_cost: 'Рекламные расходы',
  storage_cost: 'Стоимость хранения',
  cost: 'Себестоимость',
  cpc: 'CPC, руб.',
  cpo: 'CPO, руб.',
  drr: 'ДРР, %',
  region: 'Кластер / федеральный округ', area: 'Регион / область', city: 'Населённый пункт', delivery_time: 'Время доставки', geo_orders_total: 'Заказы, шт',
  geo_product_local_orders: 'Локальные заказы, шт', geo_product_nonlocal_orders: 'Не локальные заказы, шт',
  geo_wb_local_orders: 'WB локально, шт', geo_wb_nonlocal_orders: 'WB не локально, шт',
  geo_mp_local_orders: 'МП локально, шт', geo_mp_nonlocal_orders: 'МП не локально, шт',
  geo_stock_wb: 'Остатки WB, шт', geo_stock_mp: 'Остатки МП, шт',
  search_query: 'Поисковый запрос', search_category: 'Предмет', search_requests: 'Количество запросов', search_requests_previous: 'Запросы — предыдущий период',
  search_avg_daily: 'Запросов в среднем за день', search_avg_daily_previous: 'Среднее — предыдущий период',
  search_card_clicks: 'Переходы в карточку', search_card_clicks_previous: 'Переходы — предыдущий период',
  search_carts: 'Добавления в корзину', search_carts_previous: 'Корзины — предыдущий период',
  search_cart_conversion: 'Конверсия в корзину', search_cart_conversion_previous: 'CR корзины — предыдущий период',
  search_orders: 'Заказали товаров', search_orders_previous: 'Заказы — предыдущий период',
  search_order_conversion: 'Конверсия в заказ', search_order_conversion_previous: 'CR заказа — предыдущий период',
  search_ordered_subjects: 'Предметов с заказами', search_ordered_subjects_previous: 'Предметов — предыдущий период',
  search_products: 'Количество товаров', search_products_previous: 'Товаров — предыдущий период',
  niche_category: 'Категория', niche_subject: 'Предмет', niche_sellers: 'Продавцы', niche_active_sellers: 'Продавцы с заказами', niche_active_sellers_previous: 'Продавцы с заказами — предыдущий период',
  niche_monopolization: 'Монополизация, %', niche_monopolization_previous: 'Монополизация — предыдущий период', niche_revenue: 'Выручка, ₽', niche_revenue_previous: 'Выручка — предыдущий период',
  niche_avg_check: 'Средний чек, ₽', niche_avg_check_previous: 'Средний чек — предыдущий период', niche_product_cards: 'Карточек товара', niche_active_product_cards: 'Карточек с заказами',
  niche_active_product_cards_previous: 'Карточек с заказами — предыдущий период', niche_active_product_cards_share: 'Доля карточек с заказами', niche_weekly_turnover_days: 'Оборачиваемость, дни',
  niche_availability: 'Доступность', niche_avg_stock: 'Средние остатки', niche_buyout_rate: 'Процент выкупа', niche_buyout_rate_previous: 'Выкуп — предыдущий период', niche_avg_rating: 'Средний рейтинг',
  market_ordered_amount: 'Заказы рынка, ₽', market_own_ordered_amount: 'Наши заказы, ₽', market_amount_share: 'Наша доля по сумме',
  market_orders: 'Заказы рынка, шт', market_own_orders: 'Наши заказы, шт', market_orders_share: 'Наша доля в заказах',
  market_own_avg_check: 'Средний чек, мы', market_avg_check: 'Средний чек рынка',
  group_code: 'Код склейки',
};

const WB_FUNNEL_OVERRIDES: Record<string, string> = {
  '\u043f\u043e\u043a\u0430\u0437\u044b': 'impressions',
  '\u043f\u0435\u0440\u0435\u0445\u043e\u0434\u044b \u0432 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443': 'clicks',
  '\u043f\u0435\u0440\u0435\u0445\u043e\u0434\u044b': 'clicks',
  '\u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0432 \u043a\u043e\u0440\u0437\u0438\u043d\u0443': 'carts',
  '\u0437\u0430\u043a\u0430\u0437\u044b': 'orders',
};

const NICHE_OVERRIDES: Record<string, string> = {
  'категория': 'niche_category',
  'предмет': 'niche_subject',
};

const MARKET_OVERRIDES: Record<string, string> = {
  'дата': 'date',
  'заказы рынок': 'market_ordered_amount',
  'наши заказы': 'market_own_ordered_amount',
  'наша доля': 'market_amount_share',
  'заказы, шт, рынок': 'market_orders',
  'заказы, шт, мы': 'market_own_orders',
  'наша доля в заказах': 'market_orders_share',
  'средний чек, мы': 'market_own_avg_check',
  'средний чек рынок': 'market_avg_check',
};

const REVIEW_OVERRIDES: Record<string, string> = {
  'кабинет': 'review_cabinet',
  'id отзыва': 'review_id',
  'дата': 'date',
  'артикул продавца': 'sku',
  'артикул wb': 'wb_sku',
  'количество звезд': 'review_rating',
  'бренд': 'review_brand',
  'текст отзыва': 'review_text',
  'достоинства': 'review_advantages',
  'недостатки': 'review_disadvantages',
  'имя': 'review_author',
  'регион': 'review_country',
  'цвет': 'review_color',
  'размер': 'review_size',
  'полезность (количество минусов)': 'review_helpful_down',
  'полезность (количество плюсов)': 'review_helpful_up',
  'штрихкод': 'review_barcode',
  'ответ': 'review_response',
  'id начального отзыва': 'review_initial_id',
  'id дополнительного отзыва': 'review_additional_id',
};

const GROUP_HISTORY_OVERRIDES: Record<string, string> = {
  'склейка': 'group_code',
  'код склейки': 'group_code',
  'группа': 'group_code',
};

export function getRequiredFields(source?: ImportSource): string[] {
  if (source === 'reviews') return ['review_cabinet', 'review_id', 'date', 'review_rating'];
  if (source === 'niche_dynamics') return ['date', 'niche_category', 'niche_subject', 'niche_sellers', 'niche_revenue'];
  if (source === 'market_dynamics') return ['date', 'market_ordered_amount', 'market_own_ordered_amount', 'market_orders', 'market_own_orders'];
  if (source === 'search_queries') return ['date', 'search_query', 'search_requests', 'search_category', 'search_card_clicks', 'search_carts', 'search_orders'];
  if (source === 'geography') return ['sku', 'date', 'region', 'geo_orders_total'];
  if (source === 'entry_points') return ['sku', 'date', 'entry_section', 'entry_point', 'entry_impressions', 'entry_clicks', 'entry_carts', 'entry_orders'];
  if (source === 'profitability') return ['sku', 'profit_revenue', 'actual_profit', 'actual_margin'];
  if (source === 'group_history') return ['date', 'sku'];
  if (source === 'xway') return ['sku'];
  return ['sku', 'date'];
}

export interface ColumnMapping {
  map: Record<string, string>;
  unmapped: string[];
  missing: string[];
}

export function detectSourceFromHeaders(headers: string[]): ImportSource | null {
  const nhs = headers.map(h => normHeader(h));

  if (nhs.includes('склейка') && (nhs.includes('артикул wb') || nhs.includes('артикул продавца') || nhs.includes('артикул'))) return 'group_history';

  if (nhs.includes('id отзыва') && nhs.includes('количество звезд')) return 'reviews';

  if (nhs.includes('поисковый запрос') && nhs.includes('количество запросов')) return 'search_queries';
  if (nhs.includes('продавцы') && nhs.some(header => header.includes('монополизация')) && nhs.some(header => header.includes('карточек товара'))) return 'niche_dynamics';
  if (nhs.includes('заказы рынок') && nhs.includes('наши заказы') && nhs.includes('заказы, шт, рынок')) return 'market_dynamics';

  const geoRegion = ['\u0440\u0435\u0433\u0438\u043e\u043d', '\u043a\u043b\u0430\u0441\u0442\u0435\u0440'];
  const geoOrders = '\u0438\u0442\u043e\u0433\u043e\u0437\u0430\u043a\u0430\u0437\u043e\u0432';
  if (nhs.some(header => geoRegion.includes(compactHeader(header))) && nhs.some(header => compactHeader(header).includes(geoOrders))) return 'geography';
  if (nhs.some(header => compactHeader(header) === 'точкавхода') && nhs.some(header => compactHeader(header) === 'раздел')) return 'entry_points';

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
  return DICT[nh] || COMPACT_DICT[compactHeader(header)] || null;
}

export function autoDetectMapping(headers: string[], source?: ImportSource): ColumnMapping {
  const map: Record<string, string> = {};
  const unmapped: string[] = [];
  const DEV = import.meta.env.DEV;

  if (DEV) console.log('[cMap] autoDetectMapping source:', source, 'headers:', headers);

  for (const h of headers) {
    const nh = normHeader(h);
    const dictField = source === 'profitability'
      ? lookupProfitabilityField(h) || DICT[nh] || COMPACT_DICT[compactHeader(h)]
      : DICT[nh] || COMPACT_DICT[compactHeader(h)];
    const override = source === 'niche_dynamics'
      ? NICHE_OVERRIDES[nh]
      : source === 'market_dynamics'
      ? MARKET_OVERRIDES[nh]
      : source === 'reviews'
      ? REVIEW_OVERRIDES[nh]
      : source === 'xway'
      ? XWAY_OVERRIDES[nh]
      : source === 'group_history'
      ? GROUP_HISTORY_OVERRIDES[nh]
      : source === 'wb_funnel'
        ? WB_FUNNEL_OVERRIDES[nh]
        : undefined;
    const field = override || dictField;
    if (field) {
      map[h] = field;
      if (DEV) console.log('[cMap]  mapped:', JSON.stringify(h), '->', JSON.stringify(nh), '->', field, override ? '(xway override)' : '');
    } else {
      unmapped.push(h);
      if (DEV) console.log('[cMap]  UNMAPPED:', JSON.stringify(h), '->', JSON.stringify(nh));
    }
  }

  if (unmapped.length > 0) {
    if (DEV) console.log('[cMap] unrecognized columns:', unmapped.join(', '));
  } else {
    if (DEV) console.log('[cMap] all columns mapped:', Object.entries(map).map(([h, f]) => `${h}→${f}`).join(', '));
  }

  const found = new Set(Object.values(map));
  const missing = getRequiredFields(source).filter(f => !found.has(f));
  if (missing.length > 0) {
    if (DEV) console.log('[cMap] missing required fields:', missing);
  }

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
  if (result.length > 0 && import.meta.env.DEV) {
    console.log('[cMap] remapRows — first remapped row keys:', Object.keys(result[0]), 'values:', result[0]);
  }
  return result;
}
