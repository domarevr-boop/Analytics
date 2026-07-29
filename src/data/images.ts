export function getWbSku(sku: string): number | null {
  const cleaned = sku.split('-')[0];
  const num = Number(cleaned);
  return num > 0 ? num : null;
}

const IMAGE_CACHE_KEY = 'analytics_wb_image_urls_v1';
const IMAGE_CACHE_LIMIT = 1000;

function imageRange(sku: number) {
  return Math.floor(sku / 10000) * 10000;
}

const cdnStatic = (sku: number, size: 'c246x328' | 'c516x688' | 'big') =>
  `https://images.wbstatic.net/${size}/new/${imageRange(sku)}/${sku}-1.jpg`;

const BASKET_RANGES = [
  143, 287, 431, 719, 1007, 1061, 1115, 1169, 1313, 1601, 1655,
  1919, 2045, 2189, 2405, 2621, 2837, 3053, 3269, 3484, 3701,
  3917, 4133, 4349, 4565, 4877, 5143, 5500, 5813, 6125, 6435,
  6749, 7061, 7373, 7685, 7997, 8309, 8740, 9173, 9603, 10373,
  11141, 11336,
] as const;

function basketNumber(vol: number) {
  const index = BASKET_RANGES.findIndex(end => vol <= end);
  return String(index === -1 ? BASKET_RANGES.length + 1 : index + 1).padStart(2, '0');
}

const cdnBasket = (
  sku: number,
  size: 'tm' | 'c246x328' | 'big',
  network: 'geo' | 'legacy' = 'geo',
) => {
  const vol = Math.floor(sku / 100000);
  const part = Math.floor(sku / 1000);
  const basket = basketNumber(vol);
  const host = network === 'geo'
    ? `mow-basket-cdn-${basket}.geobasket.ru`
    : `basket-${basket}.wbbasket.ru`;
  return `https://${host}/vol${vol}/part${part}/${sku}/images/${size}/1.webp`;
};

export function getWbImageUrls(sku: string): string[] {
  const num = getWbSku(sku);
  if (!num) return [];
  const cached = getCachedWbImageUrl(String(num));
  return [...new Set([
    cached,
    cdnBasket(num, 'c246x328'),
    cdnBasket(num, 'tm'),
    cdnBasket(num, 'big'),
    cdnStatic(num, 'c246x328'),
    cdnStatic(num, 'c516x688'),
    cdnStatic(num, 'big'),
    cdnBasket(num, 'c246x328', 'legacy'),
  ].filter((url): url is string => Boolean(url)))];
}

function readImageCache(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getCachedWbImageUrl(sku: string): string | undefined {
  return readImageCache()[sku];
}

export function rememberWbImageUrl(sku: string, url: string) {
  if (typeof localStorage === 'undefined' || !sku || !url) return;
  const cache = readImageCache();
  delete cache[sku];
  cache[sku] = url;
  const entries = Object.entries(cache);
  const trimmed = entries.length > IMAGE_CACHE_LIMIT
    ? entries.slice(entries.length - IMAGE_CACHE_LIMIT)
    : entries;
  try {
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // Browser HTTP cache still keeps successfully loaded image responses.
  }
}
