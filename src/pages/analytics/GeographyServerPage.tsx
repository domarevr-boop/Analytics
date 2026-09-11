import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AnalyticsHelp from '../../components/AnalyticsHelp';
import {
  AnalyticsPageHeader,
  AnalyticsPanel,
  AnalyticsToolbar,
  EmptyState,
  KpiTile,
  PanelHeader,
  SegmentedControl,
} from '../../components/AnalyticsPrimitives';
import DateRangeFilter from '../../components/DateRangeFilter';
import {
  loadGeographyFilterOptions,
  loadGeographyLocations,
  loadGeographyProductLeaders,
  loadGeographySeries,
  loadGeographySummary,
} from '../../features/geography/geographyData';
import type {
  GeographyDataFilters,
  GeographyFilterOptions,
  GeographyFulfillment,
  GeographyLocationPage,
  GeographyProductLeader,
  GeographySeriesRow,
  GeographySummaryRow,
} from '../../features/geography/geographyDataCore';
import { geographyHelp } from './analyticsHelpContent';

type ChartMetric = 'orders' | 'deliveryHours';

const EMPTY_OPTIONS: GeographyFilterOptions = {
  minDate: null,
  maxDate: null,
  cabinetCount: 0,
  productCount: 0,
  regions: [],
  areas: [],
  cities: [],
};
const EMPTY_LOCATIONS: GeographyLocationPage = { totalCount: 0, rows: [] };
const PAGE_SIZE = 100;

const fulfillmentLabels: Record<GeographyFulfillment, string> = {
  all: 'Все заказы',
  fbo: 'FBO · Склад WB',
  fbs: 'FBS · Маркетплейс',
};

function formatNumber(value: number, digits = 1) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

function formatHours(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  const days = Math.floor(value / 24);
  const hours = Math.round(value % 24);
  return days ? `${days}д ${hours}ч` : `${hours}ч`;
}

function formatDate(value: string) {
  return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '—';
}

function shiftUtcDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function selectedSeriesValue(row: GeographySeriesRow, fulfillment: GeographyFulfillment, metric: ChartMetric) {
  if (metric === 'orders') {
    if (fulfillment === 'fbo') return row.fboOrders;
    if (fulfillment === 'fbs') return row.fbsOrders;
    return row.allOrders;
  }
  if (fulfillment === 'fbo') return row.fboDeliveryHours;
  if (fulfillment === 'fbs') return row.fbsDeliveryHours;
  return row.allDeliveryHours;
}

export default function GeographyServerPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [period, setPeriod] = useState({ start: shiftUtcDate(today, -731), end: today });
  const [bounds, setBounds] = useState({ minDate: '', maxDate: '' });
  const [boundsReady, setBoundsReady] = useState(false);
  const [options, setOptions] = useState<GeographyFilterOptions>(EMPTY_OPTIONS);
  const [summary, setSummary] = useState<GeographySummaryRow[]>([]);
  const [series, setSeries] = useState<GeographySeriesRow[]>([]);
  const [locations, setLocations] = useState<GeographyLocationPage>(EMPTY_LOCATIONS);
  const [leaders, setLeaders] = useState<GeographyProductLeader[]>([]);
  const [region, setRegion] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [fulfillment, setFulfillment] = useState<GeographyFulfillment>('all');
  const [metric, setMetric] = useState<ChartMetric>('orders');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) { setLoading(true); setError(''); }
    });
    void loadGeographyFilterOptions({ start: shiftUtcDate(today, -731), end: today })
      .then(result => {
        if (cancelled) return;
        setOptions(result);
        if (result.minDate && result.maxDate) {
          setBounds({ minDate: result.minDate, maxDate: result.maxDate });
          setPeriod({ start: result.minDate, end: result.maxDate });
        }
        setBoundsReady(true);
      })
      .catch(reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'Не удалось определить период данных V5 «География»');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [request, today]);

  useEffect(() => {
    if (!boundsReady) return;
    let cancelled = false;
    const filters: GeographyDataFilters = {
      start: period.start,
      end: period.end,
      region: region || null,
      area: area || null,
      city: city || null,
    };
    const level = !region ? 'region' : !area ? 'area' : 'city';
    queueMicrotask(() => {
      if (!cancelled) { setLoading(true); setError(''); }
    });
    void Promise.all([
      loadGeographyFilterOptions(filters),
      loadGeographySummary(filters),
      loadGeographySeries(filters),
      loadGeographyLocations(filters, level, fulfillment, PAGE_SIZE, offset),
      loadGeographyProductLeaders(filters, fulfillment, 20),
    ])
      .then(([nextOptions, nextSummary, nextSeries, nextLocations, nextLeaders]) => {
        if (cancelled) return;
        setOptions(nextOptions);
        setSummary(nextSummary);
        setSeries(nextSeries);
        setLocations(nextLocations);
        setLeaders(nextLeaders);
      })
      .catch(reason => {
        if (cancelled) return;
        setSummary([]);
        setSeries([]);
        setLocations(EMPTY_LOCATIONS);
        setLeaders([]);
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить серверную «Географию» V5');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [area, boundsReady, city, fulfillment, offset, period.end, period.start, region, request]);

  const selectedSummary = summary.find(row => row.fulfillment === fulfillment);
  const allSummary = summary.find(row => row.fulfillment === 'all');
  const fboSummary = summary.find(row => row.fulfillment === 'fbo');
  const fbsSummary = summary.find(row => row.fulfillment === 'fbs');
  const coverage = selectedSummary?.orders ? selectedSummary.coveredOrders / selectedSummary.orders * 100 : null;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(locations.totalCount / PAGE_SIZE));
  const chartData = series.map(row => ({ date: row.date, value: selectedSeriesValue(row, fulfillment, metric) }));
  const locationLevel = !region ? 'Федеральный округ' : !area ? 'Регион' : 'Населённый пункт';

  if (showHelp) return <section className="geo-page"><AnalyticsHelp data={geographyHelp} onClose={() => setShowHelp(false)} /></section>;

  return <section className="geo-page geo-page-v2 geo-server-page overview-design-page analytics-page-shell ds-page">
    <AnalyticsPageHeader
      eyebrow="Аналитика › География"
      title="География заказов"
      description="Серверная аналитика объёма заказов и сроков доставки по территориям."
      meta={<span>V5 · Supabase{bounds.maxDate ? ` · данные по ${formatDate(bounds.maxDate)}` : ''}</span>}
      actions={<button type="button" className="ds-button" onClick={() => setShowHelp(true)}>Справка</button>}
    />
    <AnalyticsToolbar
      className="geo-toolbar table-toolbar entry-analytics-toolbar"
      trailing={<button type="button" className="ds-button" onClick={() => {
        setRegion(''); setArea(''); setCity(''); setOffset(0);
        if (bounds.minDate && bounds.maxDate) setPeriod({ start: bounds.minDate, end: bounds.maxDate });
      }}>Сбросить</button>}
      status={<span>Источник: опубликованная версия импорта V5 · кабинетный доступ контролируется сервером</span>}
    >
      <div className="date-filters"><DateRangeFilter label="Период" value={period} onChange={value => { setPeriod(value); setOffset(0); }} maxDate={bounds.maxDate || today} /></div>
      <SegmentedControl value={fulfillment} label="Тип выполнения заказа" options={(Object.keys(fulfillmentLabels) as GeographyFulfillment[]).map(value => ({ value, label: fulfillmentLabels[value] }))} onChange={value => { setFulfillment(value); setOffset(0); }} />
      <div className="geo-location-filters">
        <span>География:</span>
        <select className="entry-context-select" aria-label="Федеральный округ" value={region} onChange={event => { setRegion(event.target.value); setArea(''); setCity(''); setOffset(0); }}><option value="">Все ФО</option>{options.regions.map(item => <option key={item} value={item}>{item}</option>)}</select>
        <select className="entry-context-select" aria-label="Регион" value={area} onChange={event => { setArea(event.target.value); setCity(''); setOffset(0); }}><option value="">Все регионы</option>{options.areas.map(item => <option key={item} value={item}>{item}</option>)}</select>
        <select className="entry-context-select" aria-label="Населённый пункт" value={city} onChange={event => { setCity(event.target.value); setOffset(0); }}><option value="">Все города</option>{options.cities.map(item => <option key={item} value={item}>{item}</option>)}</select>
      </div>
    </AnalyticsToolbar>

    {loading ? <EmptyState title="Загрузка данных V5" description="Получаем агрегаты «Географии» из Supabase без загрузки полного массива в браузер." /> : error ? <EmptyState title="Не удалось загрузить «Географию» V5" description={error} action={<button type="button" className="ds-button" onClick={() => { setBoundsReady(false); setRequest(value => value + 1); }}>Повторить</button>} /> : !selectedSummary?.orders ? <EmptyState title="Нет данных в выбранном срезе" description="Измените период и географические фильтры либо опубликуйте серверную партию отчёта «География заказов»." /> : <>
      <section className="geo-kpis ds-kpi-grid" aria-label="Ключевые показатели географии">
        <KpiTile className="geo-kpi" label="Заказы" value={`${formatNumber(selectedSummary.orders, 0)} шт.`} details={<div className="geo-kpi-split"><div><span>FBO</span><strong>{formatNumber(fboSummary?.orders || 0, 0)}</strong><small>{allSummary?.orders ? `${formatNumber((fboSummary?.orders || 0) / allSummary.orders * 100)}% от всех` : '—'}</small></div><div><span>FBS</span><strong>{formatNumber(fbsSummary?.orders || 0, 0)}</strong><small>{allSummary?.orders ? `${formatNumber((fbsSummary?.orders || 0) / allSummary.orders * 100)}% от всех` : '—'}</small></div></div>} />
        <KpiTile className="geo-kpi" label="Среднее время доставки" value={formatHours(selectedSummary.deliveryHours)} details={<span>Взвешено только заказами со заполненным СВД.</span>} />
        <KpiTile className="geo-kpi" label="Покрытие СВД" value={coverage === null ? '—' : `${formatNumber(coverage)}%`} details={<span>{formatNumber(selectedSummary.coveredOrders, 0)} из {formatNumber(selectedSummary.orders, 0)} заказов</span>} />
        <KpiTile className="geo-kpi" label="Товарный охват" value={formatNumber(options.productCount, 0)} details={<span>Кабинетов в доступном срезе: {formatNumber(options.cabinetCount, 0)}</span>} />
      </section>

      <div className="geo-content-grid">
        <AnalyticsPanel className="geo-chart-card" density="analytics">
          <PanelHeader title="Динамика по дням" description={`${metric === 'orders' ? 'Заказы' : 'Среднее время доставки'} · ${fulfillmentLabels[fulfillment]}`} controls={<SegmentedControl value={metric} label="Показатель графика" options={[{ value: 'orders', label: 'Заказы' }, { value: 'deliveryHours', label: 'СВД' }]} onChange={setMetric} />} />
          <div className="geo-chart"><ResponsiveContainer width="100%" height={290}><LineChart data={chartData}><CartesianGrid stroke="var(--ds-color-border-soft)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tickLine={false} axisLine={false} minTickGap={28} /><YAxis tickLine={false} axisLine={false} tickFormatter={value => metric === 'deliveryHours' ? `${formatNumber(Number(value))}ч` : formatNumber(Number(value), 0)} /><Tooltip labelFormatter={value => formatDate(String(value))} formatter={value => [metric === 'deliveryHours' ? formatHours(Number(value)) : formatNumber(Number(value), 0), metric === 'deliveryHours' ? 'СВД' : 'Заказы']} /><Line type="monotone" dataKey="value" name={fulfillmentLabels[fulfillment]} stroke={fulfillment === 'fbs' ? '#10B981' : '#3B82F6'} strokeWidth={2.5} dot={false} connectNulls /></LineChart></ResponsiveContainer></div>
        </AnalyticsPanel>
        <AnalyticsPanel className="geo-server-note" density="data">
          <PanelHeader title="Границы текущего этапа" description="Денежные метрики временно не показываются." />
          <p>Сумма заказов, прибыль, рентабельность, воронка и карта денежных показателей вернутся после переноса финансовых и рекламных источников на сервер. Локальные V4-значения к серверному срезу не подмешиваются.</p>
        </AnalyticsPanel>
      </div>

      <AnalyticsPanel className="geo-table-card" density="data">
        <div className="geo-card-head"><div><h2>{locationLevel}</h2><p>Серверная пагинация: показано до {PAGE_SIZE} строк, сортировка по числу заказов.</p></div></div>
        <div className="geo-table-wrap"><table className="geo-table"><thead><tr><th>{locationLevel}</th>{region && <th>ФО</th>}{area && <th>Регион</th>}<th>Заказы</th><th>Доля среза</th><th>СВД</th><th>Покрытие СВД</th><th>Товаров</th></tr></thead><tbody>{locations.rows.map(row => <tr key={`${row.region}|${row.area}|${row.city}`} className="geo-clickable-row" onClick={() => {
          if (!region) { setRegion(row.region); setArea(''); setCity(''); }
          else if (!area) { setArea(row.area); setCity(''); }
          else setCity(row.city);
          setOffset(0);
        }}><td>{row.city || row.area || row.region}</td>{region && <td>{row.region}</td>}{area && <td>{row.area}</td>}<td>{formatNumber(row.orders, 0)}</td><td>{formatNumber(row.orders / selectedSummary.orders * 100)}%</td><td>{formatHours(row.deliveryHours)}</td><td>{row.orders ? `${formatNumber(row.coveredOrders / row.orders * 100)}%` : '—'}</td><td>{formatNumber(row.productCount, 0)}</td></tr>)}</tbody></table></div>
        {pageCount > 1 && <div className="geo-detail-pagination"><button type="button" disabled={page === 1} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Назад</button><span>{page} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setOffset(offset + PAGE_SIZE)}>Далее</button></div>}
      </AnalyticsPanel>

      <AnalyticsPanel className="geo-table-card" density="data">
        <div className="geo-card-head"><div><h2>Лидирующие товары</h2><p>Top-20 товаров по заказам в текущем периоде и географическом срезе.</p></div></div>
        <div className="geo-table-wrap"><table className="geo-table"><thead><tr><th>Товар</th><th>Артикул продавца</th><th>WB ID</th><th>Заказы</th><th>Доля среза</th><th>СВД</th><th>Покрытие СВД</th></tr></thead><tbody>{leaders.map(row => <tr key={row.productId}><td>{row.productName}</td><td>{row.sellerSku || '—'}</td><td>{row.wbSku || '—'}</td><td>{formatNumber(row.orders, 0)}</td><td>{formatNumber(row.orders / selectedSummary.orders * 100)}%</td><td>{formatHours(row.deliveryHours)}</td><td>{row.orders ? `${formatNumber(row.coveredOrders / row.orders * 100)}%` : '—'}</td></tr>)}</tbody></table></div>
      </AnalyticsPanel>
    </>}
  </section>;
}
