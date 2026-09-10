const ORDER_FIELDS = [
  'orders_total', 'product_local_orders', 'product_nonlocal_orders',
  'wb_local_orders', 'wb_nonlocal_orders', 'marketplace_local_orders', 'marketplace_nonlocal_orders',
];

const clean = value => String(value ?? '').replace(/\u00a0/gu, ' ').trim();
const area = value => clean(value) || 'Без региона';
const city = value => clean(value) || 'Без населённого пункта';
const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function auditV4Geography(rows, products = []) {
  if (!Array.isArray(rows) || !Array.isArray(products)) throw new Error('Geography audit: rows and products must be arrays');
  const productIds = new Set(products.map(row => clean(row.id)).filter(Boolean));
  const dates = [];
  const seenRaw = new Set();
  const seenNormalized = new Map();
  const regions = new Set();
  const areas = new Set();
  const cities = new Set();
  const geographyProducts = new Set();
  const basesWithKnownAreas = new Set();
  const areasWithKnownCities = new Set();
  let rawDuplicateKeys = 0;
  let normalizedDuplicateKeys = 0;
  let conflictingNormalizedDuplicates = 0;
  let missingProduct = 0;
  let unknownProduct = 0;
  let missingRegion = 0;
  let invalidDate = 0;
  let invalidNumbers = 0;
  let negativeOrders = 0;
  let fractionalOrders = 0;
  let invalidDeliveryHours = 0;
  let rowsWithoutDelivery = 0;
  let ordersWithoutDelivery = 0;
  let fulfillmentAboveTotal = 0;
  let fulfillmentBelowTotal = 0;
  let productSplitMismatch = 0;
  const totals = { orders: 0, fbo: 0, fbs: 0, residual: 0 };

  for (const row of rows) {
    const date = clean(row.date);
    const productId = clean(row.product_id);
    const region = clean(row.region);
    const normalizedArea = area(row.area);
    const normalizedCity = city(row.city);
    if (/^20\d{2}-\d{2}-\d{2}$/u.test(date)) dates.push(date); else invalidDate += 1;
    if (!productId) missingProduct += 1;
    else {
      geographyProducts.add(productId);
      if (productIds.size && !productIds.has(productId)) unknownProduct += 1;
    }
    if (!region) missingRegion += 1; else regions.add(region);
    if (normalizedArea !== 'Без региона') areas.add(`${region}|${normalizedArea}`);
    if (normalizedCity !== 'Без населённого пункта') cities.add(`${region}|${normalizedArea}|${normalizedCity}`);
    if (normalizedArea !== 'Без региона') basesWithKnownAreas.add(`${date}|${productId}|${region}`);
    if (normalizedCity !== 'Без населённого пункта') areasWithKnownCities.add(`${date}|${productId}|${region}|${normalizedArea}`);

    const rawKey = `${String(row.date ?? '')}|${String(row.product_id ?? '')}|${String(row.region ?? '')}|${String(row.area ?? '')}|${String(row.city ?? '')}`;
    if (seenRaw.has(rawKey)) rawDuplicateKeys += 1; else seenRaw.add(rawKey);
    const key = `${date}|${productId}|${region}|${normalizedArea}|${normalizedCity}`;
    const fingerprint = JSON.stringify([row.delivery_hours, ...ORDER_FIELDS.map(field => row[field])]);
    if (seenNormalized.has(key)) {
      normalizedDuplicateKeys += 1;
      if (seenNormalized.get(key).fingerprint !== fingerprint) conflictingNormalizedDuplicates += 1;
    }
    seenNormalized.set(key, { fingerprint, row });

    const values = Object.fromEntries(ORDER_FIELDS.map(field => [field, number(row[field])]));
    if (ORDER_FIELDS.some(field => values[field] === null)) invalidNumbers += 1;
    if (ORDER_FIELDS.some(field => (values[field] ?? 0) < 0)) negativeOrders += 1;
    if (ORDER_FIELDS.some(field => values[field] !== null && !Number.isInteger(values[field]))) fractionalOrders += 1;
    const orders = values.orders_total ?? 0;
    const fbo = (values.wb_local_orders ?? 0) + (values.wb_nonlocal_orders ?? 0);
    const fbs = (values.marketplace_local_orders ?? 0) + (values.marketplace_nonlocal_orders ?? 0);
    const distributed = fbo + fbs;
    totals.orders += orders;
    totals.fbo += fbo;
    totals.fbs += fbs;
    totals.residual += orders - distributed;
    if (distributed > orders) fulfillmentAboveTotal += 1;
    if (distributed < orders) fulfillmentBelowTotal += 1;
    if ((values.product_local_orders ?? 0) + (values.product_nonlocal_orders ?? 0) !== orders) productSplitMismatch += 1;

    const delivery = row.delivery_hours == null ? null : number(row.delivery_hours);
    if (delivery === null) {
      rowsWithoutDelivery += 1;
      ordersWithoutDelivery += orders;
    } else if (delivery < 0) invalidDeliveryHours += 1;
  }

  let suppressedAggregateAreaRows = 0;
  let suppressedAggregateCityRows = 0;
  for (const row of rows) {
    const base = `${clean(row.date)}|${clean(row.product_id)}|${clean(row.region)}`;
    const areaKey = `${base}|${area(row.area)}`;
    if (area(row.area) === 'Без региона' && basesWithKnownAreas.has(base)) suppressedAggregateAreaRows += 1;
    else if (city(row.city) === 'Без населённого пункта' && areasWithKnownCities.has(areaKey)) suppressedAggregateCityRows += 1;
  }

  const canonicalRows = [...seenNormalized.values()].map(value => value.row);
  const canonical = {
    numeric: { invalidNumbers: 0, negativeOrders: 0, fractionalOrders: 0, invalidDeliveryHours: 0 },
    fulfillment: { orders: 0, fbo: 0, fbs: 0, residual: 0, rowsAboveTotal: 0, rowsBelowTotal: 0, productSplitMismatch: 0 },
    delivery: { rowsWithoutDelivery: 0, ordersWithoutDelivery: 0 },
  };
  for (const row of canonicalRows) {
    const values = Object.fromEntries(ORDER_FIELDS.map(field => [field, number(row[field])]));
    if (ORDER_FIELDS.some(field => values[field] === null)) canonical.numeric.invalidNumbers += 1;
    if (ORDER_FIELDS.some(field => (values[field] ?? 0) < 0)) canonical.numeric.negativeOrders += 1;
    if (ORDER_FIELDS.some(field => values[field] !== null && !Number.isInteger(values[field]))) canonical.numeric.fractionalOrders += 1;
    const orders = values.orders_total ?? 0;
    const fbo = (values.wb_local_orders ?? 0) + (values.wb_nonlocal_orders ?? 0);
    const fbs = (values.marketplace_local_orders ?? 0) + (values.marketplace_nonlocal_orders ?? 0);
    canonical.fulfillment.orders += orders;
    canonical.fulfillment.fbo += fbo;
    canonical.fulfillment.fbs += fbs;
    canonical.fulfillment.residual += orders - fbo - fbs;
    if (fbo + fbs > orders) canonical.fulfillment.rowsAboveTotal += 1;
    if (fbo + fbs < orders) canonical.fulfillment.rowsBelowTotal += 1;
    if ((values.product_local_orders ?? 0) + (values.product_nonlocal_orders ?? 0) !== orders) canonical.fulfillment.productSplitMismatch += 1;
    const delivery = row.delivery_hours == null ? null : number(row.delivery_hours);
    if (delivery === null) {
      canonical.delivery.rowsWithoutDelivery += 1;
      canonical.delivery.ordersWithoutDelivery += orders;
    } else if (delivery < 0) canonical.numeric.invalidDeliveryHours += 1;
  }

  dates.sort();
  return {
    counts: {
      rows: rows.length,
      products: geographyProducts.size,
      regions: regions.size,
      areas: areas.size,
      cities: cities.size,
    },
    range: { minDate: dates[0] || null, maxDate: dates.at(-1) || null, dayCount: new Set(dates).size },
    keys: { rawDuplicateKeys, normalizedDuplicateKeys, conflictingNormalizedDuplicates, canonicalRows: seenNormalized.size, missingProduct, unknownProduct, missingRegion, invalidDate },
    numeric: { invalidNumbers, negativeOrders, fractionalOrders, invalidDeliveryHours },
    fulfillment: { ...totals, rowsAboveTotal: fulfillmentAboveTotal, rowsBelowTotal: fulfillmentBelowTotal, productSplitMismatch },
    delivery: { rowsWithoutDelivery, ordersWithoutDelivery },
    hierarchy: { suppressedAggregateAreaRows, suppressedAggregateCityRows },
    canonical,
  };
}
