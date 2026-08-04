import { useEffect, useMemo, useState } from 'react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  getCxTopicDashboard, getCxTopicReviewsPage,
  type CxFilters, type CxTopicDashboard, type CxTopicExample, type CxTopicMetric,
  type CxTopicGranularity, type CxTopicReviewRow, type CxTopicSentiment, type CxTopicTrendPoint,
} from './clientExperienceApi';

const EMPTY: CxTopicDashboard = {
  workspaceVersion: 0, version: 0, selectedTopicId: null,
  granularity: 'day', mapMedians: { share: 0, topicScore: null },
  overallCxi: { value: null, previous: null, delta: null, evaluativeMentions: 0 },
  comparisons: {
    textReviews: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    classifiedReviews: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    mentions: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    topicScore: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    evaluativeShare: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    negativeShare: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
    averageRating: { current: 0, previous: 0, delta: 0, deltaPercent: 0 },
  },
  summary: {
    textReviews: 0, classifiedReviews: 0, topicMentions: 0, coverage: 0, averageRating: 0,
    negativeShare: 0, neutralShare: 0, positiveShare: 0, topicScore: null,
    evaluativeShare: 0,
  },
  groups: [], attention: [], topics: [], trend: [], products: [], negativeReasons: [], examples: [],
};

const integer = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const DRILLDOWN_PAGE_SIZE = 20;
const riskColors = { low: '#18A979', medium: '#F29F24', high: '#E45562' } as const;
const groupTitles: Record<string, string> = {
  product: 'Продуктовый опыт', service: 'Сервисный опыт', outcomes: 'Результат опыта',
};
const groupColors: Record<string, string> = { product: '#3F82F7', service: '#13A878', outcomes: '#8A68DF' };

type TrendMetric = 'topicScore' | 'mentions' | 'negativeShare' | 'positiveShare' | 'topicShare' | 'averageRating';
const trendMetrics: Record<TrendMetric, { label: string; color: string; unit: string; domain: [number | 'auto', number | 'auto']; type: 'bar' | 'line' }> = {
  topicScore: { label: 'Тональность', color: '#13A878', unit: '', domain: [0, 100], type: 'line' },
  mentions: { label: 'Упоминания', color: '#4E8DF5', unit: '', domain: [0, 'auto'], type: 'bar' },
  negativeShare: { label: 'Доля негатива', color: '#E45562', unit: '%', domain: [0, 100], type: 'line' },
  positiveShare: { label: 'Доля позитива', color: '#12A873', unit: '%', domain: [0, 100], type: 'line' },
  topicShare: { label: 'Доля отзывов с темой', color: '#826FE8', unit: '%', domain: [0, 100], type: 'line' },
  averageRating: { label: 'Средняя оценка', color: '#E7A719', unit: '', domain: [0, 5], type: 'line' },
};

type MapMetric = 'share' | 'topicScore' | 'reviewCount' | 'negativeShare' | 'positiveShare' | 'evaluativeShare' | 'averageRating' | 'problemIndex';
const mapMetrics: Record<MapMetric, { label: string; unit: string; domain: [number | 'auto', number | 'auto'] }> = {
  share: { label: 'Доля упоминаний', unit: '%', domain: [0, 'auto'] },
  topicScore: { label: 'Тональность', unit: '', domain: [0, 100] },
  reviewCount: { label: 'Упоминания', unit: '', domain: [0, 'auto'] },
  negativeShare: { label: 'Доля негатива', unit: '%', domain: [0, 100] },
  positiveShare: { label: 'Доля позитива', unit: '%', domain: [0, 100] },
  evaluativeShare: { label: 'Доля оценочных', unit: '%', domain: [0, 100] },
  averageRating: { label: 'Средняя оценка', unit: '', domain: [0, 5] },
  problemIndex: { label: 'Problem Index', unit: '', domain: [0, 100] },
};

interface TopicMapPoint extends CxTopicMetric {
  xValue: number;
  yValue: number;
  sizeValue: number;
  mapLabel: string;
}

const sentimentLabels: Record<CxTopicSentiment, string> = {
  positive: 'Позитивные отзывы', neutral: 'Нейтральные отзывы', negative: 'Негативные отзывы',
};

function day(value: string) {
  return value.slice(5).split('-').reverse().join('.');
}

function signed(value: number, suffix = ' п.п.') {
  if (!value) return `0${suffix}`;
  return `${value > 0 ? '+' : ''}${decimal.format(value)}${suffix}`;
}

function metric(value: number | null, suffix = '') {
  return value === null ? '—' : `${decimal.format(value)}${suffix}`;
}

function suggestedGranularity(start: string, end: string): CxTopicGranularity {
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1);
  return days <= 45 ? 'day' : days <= 180 ? 'week' : 'month';
}

export default function ClientExperienceTopics({ filters }: { filters: CxFilters }) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [granularityOverride, setGranularityOverride] = useState<{ period: string; value: CxTopicGranularity } | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<[TrendMetric, TrendMetric | '']>(['topicScore', '']);
  const [mapX, setMapX] = useState<MapMetric>('share');
  const [mapY, setMapY] = useState<MapMetric>('topicScore');
  const [mapSize, setMapSize] = useState<MapMetric>('reviewCount');
  const [dashboard, setDashboard] = useState<CxTopicDashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drilldownSentiment, setDrilldownSentiment] = useState<CxTopicSentiment | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<CxTopicReviewRow[]>([]);
  const [drilldownTotal, setDrilldownTotal] = useState(0);
  const [drilldownPage, setDrilldownPage] = useState(0);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState('');
  const periodKey = `${filters.start}:${filters.end}`;
  const granularity = granularityOverride?.period === periodKey
    ? granularityOverride.value
    : suggestedGranularity(filters.start, filters.end);

  useEffect(() => {
    if (!filters.start || !filters.end) return;
    let cancelled = false;
    void getCxTopicDashboard(filters, selectedTopicId, granularity).then(result => {
      if (cancelled) return;
      setDashboard(result);
      setError('');
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters, selectedTopicId, granularity]);

  useEffect(() => {
    const topicId = selectedTopicId || dashboard.selectedTopicId;
    if (!drilldownSentiment || !topicId) return;
    let cancelled = false;
    void getCxTopicReviewsPage(filters, topicId, drilldownSentiment, drilldownPage, DRILLDOWN_PAGE_SIZE).then(result => {
      if (cancelled) return;
      setDrilldownRows(result.rows);
      setDrilldownTotal(result.total);
    }).catch(reason => {
      if (!cancelled) setDrilldownError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setDrilldownLoading(false);
    });
    return () => { cancelled = true; };
  }, [dashboard.selectedTopicId, drilldownPage, drilldownSentiment, filters, selectedTopicId]);

  useEffect(() => {
    if (!drilldownSentiment) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrilldownSentiment(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drilldownSentiment]);

  const selectedTopic = useMemo(
    () => dashboard.topics.find(topic => topic.id === (selectedTopicId || dashboard.selectedTopicId)) || dashboard.topics[0],
    [dashboard.selectedTopicId, dashboard.topics, selectedTopicId],
  );
  const positiveExamples = dashboard.examples.filter(example => example.sentiment === 'positive');
  const negativeExamples = dashboard.examples.filter(example => example.sentiment === 'negative');
  const hasTonality = dashboard.summary.topicScore !== null;
  const mapPoints = useMemo(() => {
    const labeledTopics = new Set(
      [...dashboard.topics]
        .sort((left, right) => right.reviewCount - left.reviewCount)
        .slice(0, 8)
        .map(topic => topic.id),
    );
    return dashboard.topics.flatMap(topic => {
    const xValue = topic[mapX];
    const yValue = topic[mapY];
    const sizeValue = topic[mapSize];
    if (topic.reviewCount <= 0 || xValue === null || yValue === null || sizeValue === null) return [];
      const mapLabel = labeledTopics.has(topic.id)
        ? `${topic.name.slice(0, 18)}${topic.name.length > 18 ? '…' : ''}`
        : '';
      return [{ ...topic, xValue: Number(xValue), yValue: Number(yValue), sizeValue: Math.max(0, Number(sizeValue)), mapLabel }];
    });
  }, [dashboard.topics, mapSize, mapX, mapY]);
  const mapMedian = (key: 'xValue' | 'yValue') => {
    const values = mapPoints.map(point => point[key]).sort((left, right) => left - right);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  const mapXMedian = mapMedian('xValue');
  const mapYMedian = mapMedian('yValue');
  const defaultMap = mapX === 'share' && mapY === 'topicScore';
  const defaultMapXMax = Math.max(1, ...mapPoints.map(point => point.xValue)) * 1.08;
  const mapXDivider = defaultMap ? defaultMapXMax / 2 : mapXMedian;
  const mapYDivider = defaultMap ? 50 : mapYMedian;
  const cxiTopics = useMemo(
    () => [...dashboard.topics].sort((left, right) => (right.cxiContribution ?? -1) - (left.cxiContribution ?? -1)),
    [dashboard.topics],
  );
  const positiveDrivers = useMemo(
    () => dashboard.topics.filter(topic => (topic.contributionDelta || 0) > 0).sort((left, right) => (right.contributionDelta || 0) - (left.contributionDelta || 0)).slice(0, 3),
    [dashboard.topics],
  );
  const negativeDrivers = useMemo(
    () => dashboard.topics.filter(topic => (topic.contributionDelta || 0) < 0).sort((left, right) => (left.contributionDelta || 0) - (right.contributionDelta || 0)).slice(0, 3),
    [dashboard.topics],
  );
  const selectTopic = (topicId: string) => {
    if (topicId === (selectedTopicId || dashboard.selectedTopicId)) return;
    setSelectedTopicId(topicId);
    document.querySelector('.cx-topic-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const openDrilldown = (value: CxTopicSentiment) => {
    setDrilldownRows([]);
    setDrilldownTotal(0);
    setDrilldownPage(0);
    setDrilldownLoading(true);
    setDrilldownError('');
    setDrilldownSentiment(value);
  };
  const changeDrilldownPage = (value: number | ((previous: number) => number)) => {
    setDrilldownLoading(true);
    setDrilldownError('');
    setDrilldownPage(value);
  };
  const setTrendMetric = (index: 0 | 1, value: TrendMetric | '') => {
    setVisibleMetrics(current => {
      if (index === 0) {
        if (!value) return current;
        return [value, current[1] === value ? '' : current[1]];
      }
      return [current[0], value === current[0] ? '' : value];
    });
  };

  if (error) return <div className="cx-error">{error}</div>;
  if (!loading && dashboard.version === 0) {
    return <section className="page-card cx-topic-empty"><strong>Пока нет опубликованных результатов</strong><p>Создайте тему, опубликуйте словарь и дождитесь завершения перерасчёта.</p></section>;
  }

  return (
    <div className={`cx-topic-dashboard${loading ? ' loading' : ''}`}>
      <div className="cx-topic-dashboard-head">
        <div><span>СВОДКА ПО ВСЕМ ТЕМАМ</span><h2>Карта клиентского опыта</h2><p>Риски, сильные стороны и вклад тем в CXI в выбранном срезе.</p></div>
        <span className="cx-published-badge">Словарь v{dashboard.version}</span>
      </div>

      <section className="cx-cxi-overview">
        <article className="page-card cx-section cx-cxi-composite">
          <div className="cx-section-head"><div><span>КОМПОЗИТНЫЕ ИНДЕКСЫ</span><h2>Клиентский опыт по оценочным упоминаниям</h2></div></div>
          <div className="cx-cxi-cards">
            <CxiCard title="Overall CXI" value={dashboard.overallCxi.value} delta={dashboard.overallCxi.delta} note={`${integer.format(dashboard.overallCxi.evaluativeMentions)} оценочных упоминаний`} primary />
            {dashboard.groups.map(group => <CxiCard key={group.code} title={groupTitles[group.code]?.replace(' опыт', ' CXI') || group.name} value={group.cxi} delta={group.delta} note={group.name} />)}
          </div>
        </article>
        <article className="page-card cx-section cx-cxi-drivers">
          <div className="cx-section-head"><div><span>ДИНАМИКА ВКЛАДА</span><h2>Что изменило CXI</h2><p>Изменение вклада темы к прошлому равному периоду</p></div></div>
          <div className="cx-cxi-driver-columns"><CxiDrivers title="Рост" rows={positiveDrivers} tone="good" /><CxiDrivers title="Снижение" rows={negativeDrivers} tone="bad" /></div>
        </article>
      </section>

      <section className="cx-topic-overview-grid">
        <article className="page-card cx-section cx-topic-attention">
          <div className="cx-section-head"><div><span>ПРИОРИТЕТЫ</span><h2>Что требует внимания</h2><p>Темы с максимальным Problem Index</p></div></div>
          <div className="cx-topic-attention-list">
            {dashboard.attention.map(item => <button key={item.id} type="button" onClick={() => selectTopic(item.id)}>
              <i style={{ background: riskColors[item.risk] }} />
              <span><strong>{item.name}</strong><small>{item.groupName} · {integer.format(item.reviewCount)} упоминаний</small></span>
              <span><b>{decimal.format(item.problemIndex)}</b><small className={item.negativeDelta > 0 ? 'bad' : 'good'}>{signed(item.negativeDelta)}</small></span>
            </button>)}
            {!loading && dashboard.attention.length === 0 && <div className="cx-settings-empty">Нет тем с упоминаниями в выбранном срезе</div>}
          </div>
        </article>

        <article className="page-card cx-section cx-topic-map">
          <div className="cx-section-head cx-topic-map-head"><div><span>ПОЗИЦИОНИРОВАНИЕ</span><h2>Карта тем</h2></div><div className="cx-topic-map-controls"><label>X<select value={mapX} onChange={event => setMapX(event.target.value as MapMetric)}>{Object.entries(mapMetrics).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label><label>Y<select value={mapY} onChange={event => setMapY(event.target.value as MapMetric)}>{Object.entries(mapMetrics).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label><label>Размер<select value={mapSize} onChange={event => setMapSize(event.target.value as MapMetric)}>{Object.entries(mapMetrics).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label></div></div>
          <div className="cx-topic-map-chart">
            {defaultMap && <div className="cx-topic-quadrants" aria-hidden="true"><span>Нишевые · Позитивные</span><span>Мейнстрим · Позитивные</span><span>Нишевые · Негативные</span><span>Мейнстрим · Негативные</span></div>}
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 28, right: 22, bottom: 10, left: 2 }}>
                <CartesianGrid stroke="#E7EDF4" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="xValue" name={mapMetrics[mapX].label} unit={mapMetrics[mapX].unit} domain={defaultMap ? [0, defaultMapXMax] : mapMetrics[mapX].domain} tick={{ fontSize: 9, fill: '#7D8DA3' }} />
                <YAxis type="number" dataKey="yValue" name={mapMetrics[mapY].label} unit={mapMetrics[mapY].unit} domain={defaultMap ? [0, 100] : mapMetrics[mapY].domain} tick={{ fontSize: 9, fill: '#7D8DA3' }} width={36} />
                <ZAxis type="number" dataKey="sizeValue" range={[70, 850]} />
                {mapXDivider !== null && <ReferenceLine x={mapXDivider} stroke="#91A0B2" strokeDasharray="5 4" />}
                {mapYDivider !== null && <ReferenceLine y={mapYDivider} stroke="#91A0B2" strokeDasharray="5 4" />}
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<TopicMapTooltip xMetric={mapX} yMetric={mapY} sizeMetric={mapSize} />} />
                <Scatter data={mapPoints} onClick={point => selectTopic((point as unknown as TopicMapPoint).id)}>
                  {mapPoints.map(topic => <Cell key={topic.id} fill={groupColors[topic.groupCode] || '#8B99AB'} fillOpacity={0.88} stroke={topic.id === selectedTopic?.id ? '#142A45' : '#fff'} strokeWidth={topic.id === selectedTopic?.id ? 3 : 2} />)}
                  <LabelList dataKey="mapLabel" position="top" offset={7} fill="#3D526B" fontSize={8} fontWeight={700} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="cx-group-legend"><span><i className="product" />Продукт</span><span><i className="service" />Сервис</span><span><i className="outcomes" />Результат опыта</span></div>
          <div className="cx-topic-map-decoding"><span><b>X</b>{mapMetrics[mapX].label}</span><span><b>Y</b>{mapMetrics[mapY].label}</span><span><b>Размер</b>{mapMetrics[mapSize].label}</span></div>
        </article>

        <article className="page-card cx-section cx-all-topics">
          <div className="cx-section-head"><div><span>СТРУКТУРА</span><h2>Все темы</h2><p>Клик по строке открывает детализацию</p></div></div>
          <div className="cx-table-wrap">
            <table><thead><tr><th>Тема</th><th>Группа</th><th>Вес в группе</th><th>Оценочные</th><th>Тональность</th><th>Доля нег.</th><th>Вклад в CXI</th><th>Δ вклада</th></tr></thead>
              <tbody>{cxiTopics.map(topic => <tr key={topic.id} className={topic.id === selectedTopic?.id ? 'selected' : ''} onClick={() => selectTopic(topic.id)}>
                <td><i style={{ background: riskColors[topic.risk] }} /><strong>{topic.name}</strong></td><td>{topic.groupName}</td>
                <td>{decimal.format(topic.groupWeight)}%</td><td>{integer.format(topic.evaluativeMentions)}</td><td><span className={`cx-tonality-cell ${topic.topicScore === null ? 'empty' : topic.topicScore >= 70 ? 'high' : topic.topicScore >= 40 ? 'medium' : 'low'}`}>{metric(topic.topicScore)}</span></td>
                <td>{decimal.format(topic.negativeShare)}%</td><td><strong>{metric(topic.cxiContribution)}</strong></td>
                <td className={(topic.contributionDelta || 0) >= 0 ? 'good' : 'bad'}>{topic.contributionDelta === null ? '—' : signed(topic.contributionDelta)}</td>
              </tr>)}</tbody></table>
          </div>
        </article>
      </section>

      <div className="cx-topic-detail">
        <div className="cx-topic-dashboard-head"><div><span>ДЕТАЛИЗАЦИЯ ТЕМЫ</span><h2>{selectedTopic?.name || 'Тема не выбрана'}</h2><p>{selectedTopic?.groupName || 'Выберите тему в сводке'}</p></div></div>

        <section className="cx-topic-kpis">
          <TopicKpi title="Отзывы с текстом" value={integer.format(dashboard.summary.textReviews)} note="В выбранном срезе" tone="blue" trend={dashboard.trend.map(point => point.textReviews)} delta={signed(dashboard.comparisons.textReviews.deltaPercent, '%')} deltaValue={dashboard.comparisons.textReviews.deltaPercent} />
          <TopicKpi title="Классифицировано" value={integer.format(dashboard.summary.classifiedReviews)} note={`${decimal.format(dashboard.summary.coverage)}% покрытия`} tone="green" trend={dashboard.trend.map(point => point.classifiedReviews)} delta={signed(dashboard.comparisons.classifiedReviews.deltaPercent, '%')} deltaValue={dashboard.comparisons.classifiedReviews.deltaPercent} />
          <TopicKpi title="Упоминания темы" value={integer.format(selectedTopic?.reviewCount || 0)} note={`${decimal.format(selectedTopic?.share || 0)}% отзывов`} tone="violet" trend={dashboard.trend.map(point => point.mentions)} delta={signed(dashboard.comparisons.mentions.deltaPercent, '%')} deltaValue={dashboard.comparisons.mentions.deltaPercent} />
          <TopicKpi title="Тональность" value={metric(dashboard.summary.topicScore)} note={hasTonality ? `${decimal.format(dashboard.summary.evaluativeShare)}% оценочных упоминаний` : 'Нет позитивных или негативных совпадений'} tone="yellow" trend={dashboard.trend.map(point => point.topicScore)} delta={dashboard.comparisons.topicScore.delta === null ? '—' : signed(dashboard.comparisons.topicScore.delta)} deltaValue={dashboard.comparisons.topicScore.delta || 0} />
          <TopicKpi title="Доля негатива" value={`${decimal.format(dashboard.summary.negativeShare)}%`} note="Негативные совпадения темы" tone="red" trend={dashboard.trend.map(point => point.negativeShare)} delta={dashboard.comparisons.negativeShare.delta === null ? '—' : signed(dashboard.comparisons.negativeShare.delta)} deltaValue={dashboard.comparisons.negativeShare.delta || 0} inverseDelta />
        </section>

        <section className="page-card cx-sentiment-overview">
          <button type="button" onClick={() => openDrilldown('positive')}><span>Позитив</span><strong>{decimal.format(dashboard.summary.positiveShare)}%</strong><small>Показать отзывы</small></button>
          <button type="button" onClick={() => openDrilldown('neutral')}><span>Нейтрально</span><strong>{decimal.format(dashboard.summary.neutralShare)}%</strong><small>Показать отзывы</small></button>
          <button type="button" onClick={() => openDrilldown('negative')}><span>Негатив</span><strong>{decimal.format(dashboard.summary.negativeShare)}%</strong><small>Показать отзывы</small></button>
          <div><span>Оценочные</span><strong>{decimal.format(dashboard.summary.evaluativeShare)}%</strong><small>Позитив + негатив</small></div>
          <i aria-label="Распределение тональности"><b className="positive" style={{ width: `${dashboard.summary.positiveShare}%` }} /><b className="neutral" style={{ width: `${dashboard.summary.neutralShare}%` }} /><b className="negative" style={{ width: `${dashboard.summary.negativeShare}%` }} /></i>
        </section>

        <section className="cx-topic-detail-grid">
          <article className="page-card cx-section cx-topic-ranking">
            <div className="cx-section-head"><div><span>НАВИГАЦИЯ</span><h2>Темы отзывов</h2><p>Быстрое переключение</p></div></div>
            <div className="cx-topic-ranking-list">{dashboard.topics.map(topic => <button key={topic.id} type="button" className={topic.id === selectedTopic?.id ? 'active' : ''} onClick={() => selectTopic(topic.id)}><span><small>{topic.groupName}</small><strong>{topic.name}</strong></span><span><strong>{integer.format(topic.reviewCount)}</strong><small>нег. {decimal.format(topic.negativeShare)}%</small></span><i><b style={{ width: `${Math.min(100, topic.share)}%` }} /></i></button>)}</div>
          </article>

          <article className="page-card cx-section cx-topic-trend">
            <div className="cx-section-head cx-topic-trend-head"><div><span>ДИНАМИКА</span><h2>Динамика темы</h2><p>{selectedTopic?.name || 'Все темы'} · серверная агрегация</p></div><div className="cx-topic-trend-controls"><div className="cx-granularity-switch">{(['day', 'week', 'month'] as CxTopicGranularity[]).map(value => <button key={value} type="button" className={granularity === value ? 'active' : ''} onClick={() => setGranularityOverride({ period: periodKey, value })}>{value === 'day' ? 'День' : value === 'week' ? 'Неделя' : 'Месяц'}</button>)}</div><select value={visibleMetrics[0]} onChange={event => setTrendMetric(0, event.target.value as TrendMetric)}>{Object.entries(trendMetrics).map(([value, metric]) => <option key={value} value={value}>{metric.label}</option>)}</select><select value={visibleMetrics[1]} onChange={event => setTrendMetric(1, event.target.value as TrendMetric | '')}><option value="">Без второй метрики</option>{Object.entries(trendMetrics).map(([value, metric]) => <option key={value} value={value}>{metric.label}</option>)}</select></div></div>
            <TopicTrendChart data={dashboard.trend} metrics={visibleMetrics.filter(Boolean) as TrendMetric[]} />
          </article>

          <article className="page-card cx-section cx-topic-reasons">
            <div className="cx-section-head"><div><span>ДИАГНОСТИКА</span><h2>Причины негатива</h2><p>Частые сработавшие правила</p></div></div>
            <ol>{dashboard.negativeReasons.slice(0, 6).map(reason => <li key={reason.pattern}><span>{reason.pattern}</span><strong>{integer.format(reason.mentions)}</strong></li>)}</ol>
            {!loading && dashboard.negativeReasons.length === 0 && <div className="cx-settings-empty">Нет негативных совпадений</div>}
          </article>

          <article className="page-card cx-section cx-topic-examples">
            <div className="cx-section-head"><div><span>КОНТЕКСТ</span><h2>Примеры отзывов</h2><p>Последние совпадения темы</p></div></div>
            <div><ExampleColumn title="Позитивные" tone="positive" rows={positiveExamples} /><ExampleColumn title="Негативные" tone="negative" rows={negativeExamples} /></div>
          </article>
        </section>

        <section className="page-card cx-section cx-topic-products">
          <div className="cx-section-head"><div><span>ТОВАРЫ</span><h2>Где тема встречается чаще всего</h2><p>Топ-15 товаров по количеству упоминаний</p></div></div>
          <div className="cx-table-wrap"><table><thead><tr><th>Товар</th><th>Кабинет</th><th>Упоминания</th><th>Доля в товаре</th><th>Средняя оценка</th><th>Позитив</th><th>Нейтрально</th><th>Негатив</th></tr></thead><tbody>
            {dashboard.products.map(product => <tr key={product.entityKey}><td><strong>{product.productName || product.sellerSku || product.wbSku || 'Без названия'}</strong><span>SKU {product.sellerSku || '—'} · WB {product.wbSku || '—'}</span></td><td>{product.cabinetName}</td><td><strong>{integer.format(product.mentions)}</strong></td><td>{decimal.format(product.mentionShare)}%</td><td>{decimal.format(product.averageRating)} ★</td><td><span className="cx-positive-pill">{decimal.format(product.positiveShare)}%</span></td><td>{decimal.format(product.neutralShare)}%</td><td><span className="cx-negative-pill">{decimal.format(product.negativeShare)}%</span></td></tr>)}
            {!loading && dashboard.products.length === 0 && <tr><td colSpan={8} className="cx-empty">По выбранной теме пока нет совпадений</td></tr>}
          </tbody></table></div>
        </section>
      </div>

      {drilldownSentiment && <TopicDrilldown sentiment={drilldownSentiment} topicName={selectedTopic?.name || 'Выбранная тема'} rows={drilldownRows} total={drilldownTotal} page={drilldownPage} loading={drilldownLoading} error={drilldownError} onClose={() => setDrilldownSentiment(null)} onPage={changeDrilldownPage} />}
    </div>
  );
}

function TopicMapTooltip({ active, payload, xMetric, yMetric, sizeMetric }: { active?: boolean; payload?: Array<{ payload: TopicMapPoint }>; xMetric: MapMetric; yMetric: MapMetric; sizeMetric: MapMetric }) {
  const topic = payload?.[0]?.payload;
  if (!active || !topic) return null;
  const formatted = (value: number, key: MapMetric) => `${decimal.format(value)}${mapMetrics[key].unit}`;
  return <div className="cx-topic-map-tooltip"><strong>{topic.name}</strong><span>{topic.groupName}</span><dl><div><dt>X · {mapMetrics[xMetric].label}</dt><dd>{formatted(topic.xValue, xMetric)}</dd></div><div><dt>Y · {mapMetrics[yMetric].label}</dt><dd>{formatted(topic.yValue, yMetric)}</dd></div><div><dt>Размер · {mapMetrics[sizeMetric].label}</dt><dd>{formatted(topic.sizeValue, sizeMetric)}</dd></div><div><dt>Упоминания</dt><dd>{integer.format(topic.reviewCount)}</dd></div><div><dt>Оценочные</dt><dd>{decimal.format(topic.evaluativeShare)}%</dd></div><div><dt>Оценка</dt><dd>{decimal.format(topic.averageRating)} ★</dd></div></dl></div>;
}

function CxiCard({ title, value, delta, note, primary = false }: { title: string; value: number | null; delta: number | null; note: string; primary?: boolean }) {
  return <article className={primary ? 'primary' : ''}><span>{title}</span><div><strong>{metric(value)}</strong>{delta !== null && <b className={delta >= 0 ? 'good' : 'bad'}>{signed(delta)}</b>}</div><i><b style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></i><small>{note}</small></article>;
}

function CxiDrivers({ title, rows, tone }: { title: string; rows: CxTopicMetric[]; tone: 'good' | 'bad' }) {
  return <section><h3>{title}</h3>{rows.map(topic => <div key={topic.id}><span><i style={{ background: groupColors[topic.groupCode] || '#8B99AB' }} />{topic.name}</span><strong className={tone}>{signed(topic.contributionDelta || 0)}</strong></div>)}{rows.length === 0 && <small>Нет изменений для отображения</small>}</section>;
}

function TopicTrendChart({ data, metrics }: { data: CxTopicTrendPoint[]; metrics: TrendMetric[] }) {
  const primary = trendMetrics[metrics[0] || 'topicScore'];
  const secondary = metrics[1] ? trendMetrics[metrics[1]] : null;
  return <div className="cx-chart cx-topic-trend-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 8, right: secondary ? 8 : 0, bottom: 0, left: 0 }}>
    <CartesianGrid stroke="#E7EDF4" strokeDasharray="3 3" vertical={false} />
    <XAxis dataKey="date" tickFormatter={day} tick={{ fontSize: 10, fill: '#7D8DA3' }} />
    <YAxis yAxisId="primary" domain={primary.domain} unit={primary.unit} tick={{ fontSize: 10, fill: '#7D8DA3' }} width={42} />
    {secondary && <YAxis yAxisId="secondary" orientation="right" domain={secondary.domain} unit={secondary.unit} tick={{ fontSize: 10, fill: '#7D8DA3' }} width={42} />}
    <Tooltip labelFormatter={value => day(String(value))} formatter={(value, name) => {
      const metric = Object.values(trendMetrics).find(item => item.label === name);
      return metric?.unit === '%' ? `${decimal.format(Number(value))}%` : decimal.format(Number(value));
    }} />
    {metrics.map((metricKey, index) => {
      const metric = trendMetrics[metricKey];
      const axis = index === 0 ? 'primary' : 'secondary';
      return metric.type === 'bar'
        ? <Bar key={metricKey} yAxisId={axis} dataKey={metricKey} name={metric.label} fill={metric.color} fillOpacity={0.82} radius={[4, 4, 0, 0]} maxBarSize={30} />
        : <Line key={metricKey} yAxisId={axis} type="monotone" dataKey={metricKey} name={metric.label} stroke={metric.color} strokeWidth={2.2} dot={{ r: 2 }} activeDot={{ r: 4 }} />;
    })}
  </ComposedChart></ResponsiveContainer></div>;
}

function ExampleColumn({ title, tone, rows }: { title: string; tone: 'positive' | 'negative'; rows: CxTopicExample[] }) {
  return <section className={tone}><h3>{title}</h3>{rows.map(row => <article key={row.reviewId}><p>{row.reviewText || row.advantages || row.disadvantages || 'Текст отсутствует'}</p><span>{row.productName || row.sellerSku || 'Товар'} · {row.rating} ★</span></article>)}{rows.length === 0 && <small>Нет примеров</small>}</section>;
}

function TopicDrilldown({ sentiment, topicName, rows, total, page, loading, error, onClose, onPage }: { sentiment: CxTopicSentiment; topicName: string; rows: CxTopicReviewRow[]; total: number; page: number; loading: boolean; error: string; onClose: () => void; onPage: (value: number | ((previous: number) => number)) => void }) {
  return <div className="cx-drilldown-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><aside className="cx-drilldown" role="dialog" aria-modal="true" aria-label={sentimentLabels[sentiment]}><header><div><span>ДЕТАЛИЗАЦИЯ ТОНАЛЬНОСТИ</span><h2>{sentimentLabels[sentiment]}</h2><p>{topicName} · {integer.format(total)} отзывов</p></div><button type="button" aria-label="Закрыть" onClick={onClose}>×</button></header>{error && <div className="cx-error">{error}</div>}<div className={`cx-drilldown-list${loading ? ' loading' : ''}`}>{rows.map(review => <TopicReviewCard key={review.id} review={review} />)}{!loading && !error && rows.length === 0 && <div className="cx-drilldown-empty">Отзывов с такой тональностью в выбранном срезе нет</div>}</div><footer><span>{total > 0 ? `${page * DRILLDOWN_PAGE_SIZE + 1}–${Math.min(total, (page + 1) * DRILLDOWN_PAGE_SIZE)} из ${integer.format(total)}` : '0 отзывов'}</span><div><button type="button" disabled={page === 0 || loading} onClick={() => onPage(value => Math.max(0, value - 1))}>Назад</button><button type="button" disabled={(page + 1) * DRILLDOWN_PAGE_SIZE >= total || loading} onClick={() => onPage(value => value + 1)}>Далее</button></div></footer></aside></div>;
}

function TopicReviewCard({ review }: { review: CxTopicReviewRow }) {
  return <article className="cx-drilldown-review"><div className="cx-drilldown-review-head"><div><strong>{review.productName || review.sellerSku || 'Без названия'}</strong><span>SKU {review.sellerSku || '—'} · WB {review.wbSku || '—'} · {review.cabinetName}</span></div><div><span className={`cx-rating-pill rating-${review.rating}`}>{review.rating} ★</span><time>{day(review.reviewDate)}</time></div></div><p>{review.reviewText || 'Основной текст отсутствует'}</p>{(review.advantages || review.disadvantages) && <div className="cx-drilldown-fragments">{review.advantages && <span><b>Достоинства</b>{review.advantages}</span>}{review.disadvantages && <span><b>Недостатки</b>{review.disadvantages}</span>}</div>}<div className="cx-drilldown-rules"><span>Сработали:</span>{review.matchedRules.map(rule => <b key={rule.id}>{rule.pattern}</b>)}</div></article>;
}

function TopicKpi({ title, value, note, tone, trend, delta, deltaValue, inverseDelta = false }: { title: string; value: string; note: string; tone: string; trend: Array<number | null>; delta: string; deltaValue: number; inverseDelta?: boolean }) {
  const positive = inverseDelta ? deltaValue <= 0 : deltaValue >= 0;
  const sparkData = trend.map((point, index) => ({ index, value: point ?? 0 }));
  return <article className={`page-card cx-topic-kpi cx-tone-${tone}`}><span>{title}</span><div className="cx-topic-kpi-main"><strong>{value}</strong><div className="cx-topic-kpi-spark"><ResponsiveContainer width="100%" height="100%"><LineChart data={sparkData}><Line type="monotone" dataKey="value" stroke="var(--cx-tone)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></div><div className="cx-topic-kpi-meta"><small>{note}</small><b className={positive ? 'good' : 'bad'}>{delta}</b></div><i /></article>;
}
