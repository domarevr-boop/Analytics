import { useMemo, useState, useSyncExternalStore } from 'react';
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import FilterBar from '../../components/FilterBar';
import { appendToMap } from '../../data/collectionUtils';
import { getFilteredProductIds } from '../../data/productFilters';
import { getCabinets, getGroups, getGroupMembershipHistory, getMemberships, getMetrics, getProducts, getVersion, subscribe, UNGROUPED_GROUP_ID } from '../../data/store';
import type { DailyMetrics, Product } from '../../types';
import { resolveGroupAtDate } from '../../data/groupMembershipHistory';
import { aggregateFunnel as aggregate } from './funnelCalculations';

type Grouping = 'product' | 'group' | 'cabinet';
type Volume = 'impressions' | 'clicks' | 'carts' | 'orders' | 'ordered_amount';
type Rate = 'ctr' | 'cartCr' | 'cartOrderCr' | 'clickOrderCr' | 'impressionOrderCr';
type SortKey = Volume | Rate;
type FunnelSummary = ReturnType<typeof aggregate>;
type MapRow = FunnelSummary & { id: string; name: string; product?: Product; groupId?: string };
type TreeRow = MapRow & { depth: number; type: 'cabinet' | 'group' | 'product'; parent: string | null; hasChildren: boolean };

const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const compactFormatter = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (value: number) => numberFormatter.format(Number.isFinite(value) ? value : 0);
const pct = (value: number) => `${fmt(value)}%`;
const volumes: Record<Volume, string> = { impressions: 'Показы', clicks: 'Переходы', carts: 'Корзины', orders: 'Заказы', ordered_amount: 'Заказано, ₽' };
const rates: Record<Rate, string> = { ctr: 'CTR', cartCr: 'CR переход → корзина', cartOrderCr: 'CR корзина → заказ', clickOrderCr: 'CR переход → заказ', impressionOrderCr: 'CR показ → заказ' };

function percentile(values: number[], point: number) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * point)] : 0;
}

function parseRanges(value: string) {
  return value.split(',').map(item => item.trim().match(/^(\d+)\s*-\s*(\d+|∞)$/)).filter(Boolean).map(match => ({
    from: Number(match![1]), to: match![2] === '∞' ? Infinity : Number(match![2]),
  })).filter(range => range.to > range.from);
}

function stageColor(index: number) {
  return ['blue', 'sky', 'teal', 'green', 'lime'][index] || 'blue';
}

export default function FunnelPage() {
  useSyncExternalStore(subscribe, getVersion);
  const metrics = getMetrics(); const products = getProducts(); const groups = getGroups(); const memberships = getMemberships(); const groupHistory = getGroupMembershipHistory(); const cabinets = getCabinets();
  const dates = useMemo(() => [...new Set(metrics.map(metric => metric.date))].sort(), [metrics]);
  const [start, setStart] = useState(() => dates[0] || ''); const [end, setEnd] = useState(() => dates.at(-1) || '');
  const [cabinet, setCabinet] = useState(''); const [category, setCategory] = useState(''); const [brand, setBrand] = useState(''); const [group, setGroup] = useState(''); const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<Grouping>('product'); const [xMetric, setXMetric] = useState<Volume>('impressions'); const [yMetric, setYMetric] = useState<Rate>('impressionOrderCr'); const [sizeMetric, setSizeMetric] = useState<Volume>('ordered_amount'); const [colorMetric, setColorMetric] = useState<Rate>('clickOrderCr');
  const [rangesInput, setRangesInput] = useState('0-1000, 1000-2000, 2000-4000, 4000-∞'); const [hideAnomalies, setHideAnomalies] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('ordered_amount'); const [expanded, setExpanded] = useState<Set<string>>(new Set()); const [tablePage, setTablePage] = useState(0);

  const productMap = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const groupMap = useMemo(() => new Map(groups.map(item => [item.id, item])), [groups]);
  const cabinetMap = useMemo(() => new Map(cabinets.map(item => [item.id, item])), [cabinets]);
  const allowedProductIds = useMemo(() => getFilteredProductIds(products, memberships, { cabinetFilter: cabinet, categoryFilter: category, brandFilter: brand, groupFilter: group, skuFilter: query }, { groupHistory, period: { start, end } }), [products, memberships, groupHistory, cabinet, category, brand, group, query, start, end]);
  const filtered = useMemo(() => metrics.filter(row => {
    if ((!start || row.date < start) || (!end || row.date > end) || !allowedProductIds.has(row.product_id)) return false;
    if (!group) return true;
    const resolution = resolveGroupAtDate(row.product_id, row.date, groupHistory, memberships);
    return resolution.known && resolution.groupId === group;
  }), [metrics, allowedProductIds, start, end, group, groupHistory, memberships]);
  const totals = useMemo(() => aggregate(filtered), [filtered]);

  const productRows = useMemo<MapRow[]>(() => {
    const byProduct = new Map<string, DailyMetrics[]>();
    filtered.forEach(row => appendToMap(byProduct, row.product_id, row));
    return [...byProduct.entries()].map(([id, rows]) => {
      const product = productMap.get(id);
      return { id, name: product?.sku || id, product, ...aggregate(rows) };
    }).filter(row => row.impressions || row.clicks || row.carts || row.orders || row.ordered_amount);
  }, [filtered, productMap]);

  const groupProductRows = useMemo(() => {
    const byKey = new Map<string, DailyMetrics[]>();
    filtered.forEach(row => {
      const resolution = resolveGroupAtDate(row.product_id, row.date, groupHistory, memberships);
      const groupId = resolution.known && resolution.groupId ? resolution.groupId : UNGROUPED_GROUP_ID;
      appendToMap(byKey, `${row.product_id}|${groupId}`, row);
    });
    return [...byKey.entries()].map(([key, rows]) => {
      const [productId, ...groupParts] = key.split('|');
      const groupId = groupParts.join('|');
      const product = productMap.get(productId);
      return { id: key, name: product?.sku || productId, product, groupId, ...aggregate(rows) };
    }).filter(row => row.impressions || row.clicks || row.carts || row.orders || row.ordered_amount);
  }, [filtered, groupHistory, memberships, productMap]);

  const mapData = useMemo<MapRow[]>(() => {
    if (grouping === 'product') return productRows;
    const buckets = new Map<string, MapRow[]>();
    if (grouping === 'group') {
      groupProductRows.forEach(row => appendToMap(buckets, row.groupId || UNGROUPED_GROUP_ID, row));
      return [...buckets.entries()].map(([id, rows]) => ({
        id,
        name: id === UNGROUPED_GROUP_ID ? 'Без склейки' : groupMap.get(id)?.name || 'Без склейки',
        ...aggregate(rows),
      }));
    }
    productRows.forEach(row => {
      if (grouping === 'cabinet') {
        const id = row.product?.cabinet_id || 'missing-cabinet'; appendToMap(buckets, id, row); return;
      }
    });
    return [...buckets.entries()].map(([id, rows]) => ({
      id,
      name: grouping === 'cabinet' ? cabinetMap.get(id)?.name || 'Без кабинета' : id.startsWith('ungrouped:') ? 'Без склейки' : groupMap.get(id)?.name || 'Без склейки',
      ...aggregate(rows),
    }));
  }, [cabinetMap, groupMap, grouping, groupProductRows, productRows]);

  const mapLimitX = useMemo(() => percentile(mapData.map(row => row[xMetric]), .99), [mapData, xMetric]);
  const mapLimitY = useMemo(() => percentile(mapData.map(row => row[yMetric]), .99), [mapData, yMetric]);
  const visibleMap = useMemo(() => hideAnomalies ? mapData.filter(row => row[xMetric] <= mapLimitX && row[yMetric] <= mapLimitY) : mapData, [mapData, hideAnomalies, mapLimitX, mapLimitY, xMetric, yMetric]);
  const colorRange = useMemo(() => {
    const values = visibleMap.map(row => row[colorMetric]); return { min: Math.min(...values, 0), max: Math.max(...values, 0) };
  }, [colorMetric, visibleMap]);
  const mapColor = (value: number) => {
    const share = colorRange.max === colorRange.min ? .5 : (value - colorRange.min) / (colorRange.max - colorRange.min);
    return `hsl(${Math.round(8 + share * 145)} 62% ${Math.round(57 - share * 10)}%)`;
  };

  const transitions = useMemo(() => [
    { name: 'Показы → переходы', rate: totals.ctr, loss: Math.max(0, totals.impressions - totals.clicks), source: totals.impressions },
    { name: 'Переходы → корзины', rate: totals.cartCr, loss: Math.max(0, totals.clicks - totals.carts), source: totals.clicks },
    { name: 'Корзины → заказы', rate: totals.cartOrderCr, loss: Math.max(0, totals.carts - totals.orders), source: totals.carts },
  ], [totals]);
  const strongest = useMemo(() => [...transitions].sort((left, right) => right.rate - left.rate)[0], [transitions]);
  const weakest = useMemo(() => [...transitions].sort((left, right) => left.rate - right.rate)[0], [transitions]);
  const largestGap = useMemo(() => [...transitions].sort((left, right) => right.loss - left.loss)[0], [transitions]);

  const stages = [
    { label: '1. Показы', value: totals.impressions, sub: `CTR ${pct(totals.ctr)}` },
    { label: '2. Переходы', value: totals.clicks, sub: `CR корзины ${pct(totals.cartCr)}` },
    { label: '3. Корзины', value: totals.carts, sub: `CR заказа ${pct(totals.cartOrderCr)}` },
    { label: '4. Заказы', value: totals.orders, sub: `Средний чек ${fmt(totals.avgPrice)} ₽` },
    { label: '5. Заказано, ₽', value: totals.ordered_amount, sub: `CR показ → заказ ${pct(totals.impressionOrderCr)}`, money: true },
  ];

  const segments = useMemo(() => parseRanges(rangesInput).map(range => {
    const rows = productRows.filter(row => row.avgPrice >= range.from && row.avgPrice < range.to); const summary = aggregate(rows);
    return {
      label: `${fmt(range.from)}–${range.to === Infinity ? '∞' : fmt(range.to)} ₽`, products: rows.length,
      orderShare: totals.orders ? summary.orders / totals.orders * 100 : 0, revenueShare: totals.ordered_amount ? summary.ordered_amount / totals.ordered_amount * 100 : 0,
      avgCr: summary.impressionOrderCr, avgPrice: summary.avgPrice,
    };
  }), [productRows, rangesInput, totals]);

  const focusRows = useMemo(() => [...productRows].sort((left, right) => right.ordered_amount - left.ordered_amount).slice(0, 6).map(row => {
    const stageRates = [{ name: 'Показы → переходы', value: row.ctr }, { name: 'Переходы → корзины', value: row.cartCr }, { name: 'Корзины → заказы', value: row.cartOrderCr }];
    const narrowest = [...stageRates].sort((left, right) => left.value - right.value)[0];
    return { ...row, narrowest };
  }), [productRows]);
  const heatRows = useMemo(() => [...productRows].sort((left, right) => right.orders - left.orders).slice(0, 8), [productRows]);

  const treeRows = useMemo<TreeRow[]>(() => {
    const rowsByCabinet = new Map<string, MapRow[]>(); productRows.forEach(row => appendToMap(rowsByCabinet, row.product?.cabinet_id || 'missing-cabinet', row));
    const result: TreeRow[] = [];
    [...rowsByCabinet.entries()].sort(([, left], [, right]) => aggregate(right)[sortKey] - aggregate(left)[sortKey]).forEach(([cabinetId, cabinetProducts]) => {
      const cabinetRow: TreeRow = { id: `cabinet:${cabinetId}`, name: cabinetMap.get(cabinetId)?.name || 'Без кабинета', depth: 0, type: 'cabinet', parent: null, hasChildren: true, ...aggregate(cabinetProducts) };
      result.push(cabinetRow); if (!expanded.has(cabinetRow.id)) return;
      const rowsByGroup = new Map<string, MapRow[]>(); groupProductRows.filter(row => row.product?.cabinet_id === cabinetId).forEach(row => {
        appendToMap(rowsByGroup, row.groupId || UNGROUPED_GROUP_ID, row);
      });
      [...rowsByGroup.entries()].sort(([, left], [, right]) => aggregate(right)[sortKey] - aggregate(left)[sortKey]).forEach(([groupId, groupProducts]) => {
        const groupRow: TreeRow = { id: `group:${cabinetId}:${groupId}`, name: groupId === UNGROUPED_GROUP_ID ? 'Без склейки' : groupMap.get(groupId)?.name || 'Без склейки', depth: 1, type: 'group', parent: cabinetRow.id, hasChildren: true, ...aggregate(groupProducts) };
        result.push(groupRow); if (!expanded.has(groupRow.id)) return;
        [...groupProducts].sort((left, right) => right[sortKey] - left[sortKey]).forEach(row => result.push({ ...row, depth: 2, type: 'product', parent: groupRow.id, hasChildren: false }));
      });
    });
    return result;
  }, [cabinetMap, expanded, groupMap, groupProductRows, productRows, sortKey]);
  const pageSize = 40; const pageCount = Math.max(1, Math.ceil(treeRows.length / pageSize)); const safeTablePage = Math.min(tablePage, pageCount - 1); const visibleTreeRows = treeRows.slice(safeTablePage * pageSize, (safeTablePage + 1) * pageSize);

  const toggleRow = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  if (!metrics.length) return <section className="funnel-page analytics-empty-page">
    <header className="entry-header"><span className="geo-eyebrow">АНАЛИТИКА</span><h1>Воронка продаж</h1><p>Диагностика эффективности ассортимента по локальным данным воронки.</p></header>
    <article className="analytics-empty-card"><span>ДАННЫЕ НЕ ЗАГРУЖЕНЫ</span><h2>Воронка пока недоступна</h2><p>Загрузите отчёт «Воронка WB», чтобы увидеть этапы, конверсии и сравнение SKU.</p></article>
  </section>;

  return <section className="funnel-page funnel-page-v2">
    <header className="entry-header"><div><span className="geo-eyebrow">АНАЛИТИКА</span><h1>Воронка продаж</h1><p>Диагностика эффективности ассортимента, SKU и ценовых сегментов по всей воронке.</p></div></header>
    <div className="entry-toolbar table-toolbar entry-analytics-toolbar page-card funnel-toolbar"><div className="date-filters"><DateRangeFilter label="Период" value={{ start, end }} onChange={period => { setStart(period.start); setEnd(period.end); }} maxDate={dates.at(-1) || end} /></div><FilterBar cabinetFilter={cabinet} categoryFilter={category} brandFilter={brand} groupFilter={group} skuFilter={query} onCabinetChange={setCabinet} onCategoryChange={setCategory} onBrandChange={setBrand} onGroupChange={setGroup} onSkuChange={setQuery} period={{ start, end }} variant="dashboard" /></div>

    <article className="entry-card funnel-overview">
      <div className="funnel-section-head"><div><h2>Воронка продаж</h2><p>{fmt(productRows.length)} SKU в выбранном срезе</p></div><span>Локальные данные</span></div>
      <div className="funnel-stage-row">{stages.map((stage, index) => <div className="funnel-stage-wrap" key={stage.label}><div className={`funnel-stage ${stageColor(index)}`}><span>{stage.label}</span><strong>{stage.money ? `${compactFormatter.format(stage.value)} ₽` : compactFormatter.format(stage.value)}</strong></div><small>{stage.sub}</small>{index < transitions.length && <div className="funnel-transition"><b>{pct(transitions[index].rate)}</b><span>−{compactFormatter.format(transitions[index].loss)}</span></div>}</div>)}</div>
      <div className="funnel-diagnostics">
        <article className="good"><span>Максимальная соседняя CR</span><strong>{pct(strongest?.rate || 0)}</strong><small>{strongest?.name || 'Нет данных'} · без benchmark</small></article>
        <article className="bad"><span>Минимальная соседняя CR</span><strong>{pct(weakest?.rate || 0)}</strong><small>{weakest?.name || 'Нет данных'} · без benchmark</small></article>
        <article className="warn"><span>Максимальный разрыв</span><strong>{compactFormatter.format(largestGap?.loss || 0)}</strong><small>{largestGap?.name || 'Нет данных'} · абсолютное значение</small></article>
        <article className="muted"><span>Потенциал роста</span><strong>Не рассчитан</strong><small>Нужны утверждённые benchmark и формула</small></article>
      </div>
    </article>

    <div className="funnel-analysis-grid">
      <article className="entry-card funnel-map-card"><div className="entry-card-head"><div><h2>Матрица эффективности SKU</h2><p>Каждая точка — выбранный уровень агрегации.</p></div><div className="entry-map-controls"><select aria-label="Группировка" value={grouping} onChange={event => setGrouping(event.target.value as Grouping)}><option value="product">По артикулам</option><option value="group">По склейкам</option><option value="cabinet">По кабинетам</option></select><label>X<select value={xMetric} onChange={event => setXMetric(event.target.value as Volume)}>{Object.entries(volumes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Y<select value={yMetric} onChange={event => setYMetric(event.target.value as Rate)}>{Object.entries(rates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Размер<select value={sizeMetric} onChange={event => setSizeMetric(event.target.value as Volume)}>{Object.entries(volumes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Цвет<select value={colorMetric} onChange={event => setColorMetric(event.target.value as Rate)}>{Object.entries(rates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></div>
        <div className="funnel-map-note"><label><input type="checkbox" checked={hideAnomalies} onChange={event => setHideAnomalies(event.target.checked)} /> Исключать верхний 1% по осям</label><span>Квадранты не показаны: пороги не утверждены · скрыто {mapData.length - visibleMap.length}</span></div>
        <ResponsiveContainer width="100%" height={320}><ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 2 }}><CartesianGrid stroke="#E7ECF2" strokeDasharray="3 3" /><XAxis dataKey={xMetric} type="number" domain={[0, mapLimitX || 'auto']} tickFormatter={value => compactFormatter.format(Number(value))} tick={{ fontSize: 9, fill: '#78879B' }} /><YAxis dataKey={yMetric} type="number" unit="%" domain={[0, mapLimitY || 'auto']} tick={{ fontSize: 9, fill: '#78879B' }} width={42} /><ZAxis dataKey={sizeMetric} range={[45, 800]} /><ReferenceLine x={0} stroke="transparent" /><Tooltip content={({ active, payload }) => { const item = payload?.[0]?.payload as MapRow | undefined; return active && item ? <div className="entry-tooltip"><strong>{item.name}</strong><span>{volumes[xMetric]}: {fmt(item[xMetric])}</span><span>{rates[yMetric]}: {pct(item[yMetric])}</span><span>{volumes[sizeMetric]}: {fmt(item[sizeMetric])}</span><span>{rates[colorMetric]}: {pct(item[colorMetric])}</span></div> : null; }} /><Scatter data={visibleMap}>{visibleMap.map(item => <Cell key={item.id} fill={mapColor(item[colorMetric])} fillOpacity={.82} stroke="#fff" strokeWidth={1} />)}</Scatter></ScatterChart></ResponsiveContainer>
      </article>

      <article className="entry-card funnel-focus-card"><div className="entry-card-head"><div><h2>SKU для проверки</h2><p>Топ по сумме заказов; указан минимальный этап CR.</p></div></div><div className="funnel-focus-list">{focusRows.map(row => <div key={row.id}><span><strong>{row.product?.sku || row.name}</strong><small>{row.product?.name || 'Название не задано'}</small></span><span><b>{row.narrowest.name}</b><small>{pct(row.narrowest.value)}</small></span><em>{compactFormatter.format(row.ordered_amount)} ₽</em></div>)}</div><p className="funnel-method-note">Это диагностический список, не автоматическая рекомендация. Правила действий и потенциальный эффект требуют отдельной методологии.</p></article>
    </div>

    <article className="entry-card funnel-segments-card"><div className="entry-card-head"><div><h2>Эффективность ценовых сегментов</h2><p>Границы задаются пользователем и не являются встроенной классификацией.</p></div><label className="range-input">Диапазоны, ₽<input value={rangesInput} onChange={event => setRangesInput(event.target.value)} placeholder="0-1000, 1000-2000, 2000-∞" /></label></div><div className="funnel-segment-grid">{segments.map(segment => <article key={segment.label}><header><div><strong>{segment.label}</strong><small>{segment.products} SKU</small></div><span>{pct(segment.orderShare)} заказов</span></header><dl><div><dt>Доля заказов</dt><dd><i style={{ width: `${Math.min(100, segment.orderShare)}%` }} /></dd></div><div><dt>Доля выручки</dt><dd><i style={{ width: `${Math.min(100, segment.revenueShare)}%` }} /></dd></div><div><dt>Средний CR</dt><dd>{pct(segment.avgCr)}</dd></div><div><dt>Средний чек</dt><dd>{fmt(segment.avgPrice)} ₽</dd></div></dl></article>)}</div></article>

    <article className="entry-card funnel-heatmap-card"><div className="entry-card-head"><div><h2>Карта конверсий по SKU</h2><p>Топ-8 SKU по заказам; длина полосы соответствует фактическому проценту от 0 до 100.</p></div></div><div className="entry-table-wrap"><table><thead><tr><th>SKU / наименование</th><th>CTR</th><th>CR переход → корзина</th><th>CR корзина → заказ</th><th>CR показ → заказ</th><th>Заказано, ₽</th></tr></thead><tbody>{heatRows.map(row => <tr key={row.id}><td><strong>{row.product?.sku || row.name}</strong><small>{row.product?.name || 'Название не задано'}</small></td>{(['ctr', 'cartCr', 'cartOrderCr', 'impressionOrderCr'] as Rate[]).map(metric => <td key={metric}><div className="funnel-rate-cell"><i style={{ width: `${Math.min(100, row[metric])}%` }} /><span>{pct(row[metric])}</span></div></td>)}<td><strong>{fmt(row.ordered_amount)} ₽</strong></td></tr>)}</tbody></table></div></article>

    <article className="entry-card entry-table-card funnel-detail-card"><div className="entry-card-head"><div><h2>SKU и склейки</h2><p>Кабинет → склейка → артикул · {treeRows.length} видимых строк</p></div><label className="funnel-sort">Сортировка<select value={sortKey} onChange={event => { setSortKey(event.target.value as SortKey); setTablePage(0); }}>{[...Object.entries(volumes), ...Object.entries(rates)].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="entry-table-wrap"><table><thead><tr><th>Сущность</th><th>Показы</th><th>Переходы</th><th>CTR</th><th>Корзины</th><th>Заказы</th><th>CR корзина → заказ</th><th>CR показ → заказ</th><th>Заказано, ₽</th></tr></thead><tbody>{visibleTreeRows.map(row => <tr key={row.id} className={`funnel-tree-${row.type}`}><td style={{ paddingLeft: 10 + row.depth * 18 }}>{row.hasChildren ? <button type="button" className="funnel-expand" aria-label={`${expanded.has(row.id) ? 'Свернуть' : 'Развернуть'} ${row.name}`} onClick={() => toggleRow(row.id)}>{expanded.has(row.id) ? '−' : '+'}</button> : <span className="funnel-tree-leaf" />}<span><strong>{row.name}</strong>{row.product?.name && <small>{row.product.name}</small>}</span></td><td>{fmt(row.impressions)}</td><td>{fmt(row.clicks)}</td><td>{pct(row.ctr)}</td><td>{fmt(row.carts)}</td><td>{fmt(row.orders)}</td><td>{pct(row.cartOrderCr)}</td><td>{pct(row.impressionOrderCr)}</td><td><strong>{fmt(row.ordered_amount)} ₽</strong></td></tr>)}</tbody></table></div><footer className="funnel-table-footer"><span>Страница {safeTablePage + 1} из {pageCount}</span><div><button type="button" disabled={safeTablePage === 0} onClick={() => setTablePage(Math.max(0, safeTablePage - 1))}>←</button><button type="button" disabled={safeTablePage + 1 >= pageCount} onClick={() => setTablePage(Math.min(pageCount - 1, safeTablePage + 1))}>→</button></div></footer></article>

    <article className="entry-card funnel-next-card"><div><span>МЕТОДОЛОГИЯ ДЕЙСТВИЙ</span><h2>Что делать дальше</h2><p>Автоматические группы действий не сформированы: в проекте пока нет утверждённых правил связи этапов воронки с рекомендациями и расчётом эффекта.</p></div><strong>Нужно определить benchmark, правила сегментации и формулу потенциала.</strong></article>
  </section>;
}
