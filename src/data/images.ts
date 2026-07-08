export function getWbSku(sku: string): number | null {
  const cleaned = sku.split('-')[0];
  const num = Number(cleaned);
  return num > 0 ? num : null;
}

const cdnStatic = (sku: number) => `https://images.wbstatic.net/c246x328/${sku}_1.jpg`;

const cdnBasket = (sku: number) => {
  const vol = Math.floor(sku / 100000);
  const part = Math.floor(sku / 1000);
  const basket = String(vol % 20 + 1).padStart(2, '0');
  return `https://basket-${basket}.wbbasket.ru/vol${vol}/part${part}/${sku}/images/big/1.webp`;
};

export function getWbImageUrls(sku: string): string[] {
  const num = getWbSku(sku);
  if (!num) return [];
  return [cdnStatic(num), cdnBasket(num)];
}
