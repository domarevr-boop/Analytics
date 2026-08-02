import { useEffect, useMemo, useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  getCxTopicDashboard, getCxTopicReviewsPage,
  type CxFilters,
  type CxTopicDashboard, type CxTopicReviewRow, type CxTopicSentiment,
} from './clientExperienceApi';

const EMPTY: CxTopicDashboard = {
  version: 0,
  selectedTopicId: null,
  summary: {
    textReviews: 0, classifiedReviews: 0, topicMentions: 0, coverage: 0, averageRating: 0,
    negativeShare: 0, neutralShare: 0, positiveShare: 0, topicScore: 0,
  },
  topics: [], trend: [], products: [],
};

const integer = new Intl.NumberFormat('ru-RU');
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const DRILLDOWN_PAGE_SIZE = 20;

const sentimentLabels: Record<CxTopicSentiment, string> = {
  positive: 'Позитивные отзывы', neutral: 'Нейтральные отзывы', negative: 'Негативные отзывы',
};

function day(value: string) {
  return value.slice(5).split('-').reverse().join('.');
}

export default function ClientExperienceTopics({ filters }: { filters: CxFilters }) {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<CxTopicDashboard>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drilldownSentiment, setDrilldownSentiment] = useState<CxTopicSentiment | null>(null);
  const [drilldownRows, setDrilldownRows] = useState<CxTopicReviewRow[]>([]);
  const [drilldownTotal, setDrilldownTotal] = useState(0);
  const [drilldownPage, setDrilldownPage] = useState(0);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState('');

  useEffect(() => {
    if (!filters.start || !filters.end) return;
    let cancelled = false;
    void getCxTopicDashboard(filters, selectedTopicId).then(result => {
      if (cancelled) return;
      setDashboard(result);
      setError('');
      if (!selectedTopicId || !result.topics.some(topic => topic.id === selectedTopicId)) {
        const firstTopic = result.topics.find(topic => topic.reviewCount > 0);
        if (firstTopic) setSelectedTopicId(firstTopic.id);
      }
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters, selectedTopicId]);

  useEffect(() => {
    if (!drilldownSentiment || !selectedTopicId) return;
    let cancelled = false;
    setDrilldownLoading(true);
    setDrilldownError('');
    void getCxTopicReviewsPage(filters, selectedTopicId, drilldownSentiment, drilldownPage, DRILLDOWN_PAGE_SIZE).then(result => {
      if (cancelled) return;
      setDrilldownRows(result.rows);
      setDrilldownTotal(result.total);
    }).catch(reason => {
      if (!cancelled) setDrilldownError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setDrilldownLoading(false);
    });
    return () => { cancelled = true; };
  }, [drilldownPage, drilldownSentiment, filters, selectedTopicId]);

  useEffect(() => {
    if (!drilldownSentiment) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrilldownSentiment(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [drilldownSentiment]);

  const selectedTopic = useMemo(
    () => dashboard.topics.find(topic => topic.id === selectedTopicId) || dashboard.topics[0],
    [dashboard.topics, selectedTopicId],
  );
  const hasSentiment = dashboard.summary.positiveShare > 0 || dashboard.summary.negativeShare > 0;
  const openDrilldown = (value: CxTopicSentiment) => {
    setDrilldownRows([]);
    setDrilldownTotal(0);
    setDrilldownPage(0);
    setDrilldownSentiment(value);
  };

  if (error) return <div className="cx-error">{error}</div>;
  if (!loading && dashboard.version === 0) {
    return (
      <section className="page-card cx-topic-empty">
        <strong>Пока нет опубликованных результатов</strong>
        <p>Создайте хотя бы одну тему в настройках, проверьте словарь и опубликуйте его. После завершения перерасчёта здесь появится дашборд.</p>
      </section>
    );
  }

  return (
    <div className={`cx-topic-dashboard${loading ? ' loading' : ''}`}>
      <div className="cx-topic-dashboard-head">
        <div>
          <span>ТЕМАТИЧЕСКАЯ АНАЛИТИКА</span>
          <h2>{selectedTopic?.name || 'Все темы'}</h2>
          <p>Результаты последней полностью рассчитанной версии словаря.</p>
        </div>
        <span className="cx-published-badge">Словарь v{dashboard.version}</span>
      </div>

      <section className="cx-topic-kpis">
        <TopicKpi title="Отзывы с текстом" value={integer.format(dashboard.summary.textReviews)} note="В выбранном срезе" tone="blue" />
        <TopicKpi title="Классифицировано" value={integer.format(dashboard.summary.classifiedReviews)} note={`${decimal.format(dashboard.summary.coverage)}% покрытия`} tone="green" />
        <TopicKpi title="Упоминания темы" value={integer.format(selectedTopic?.reviewCount || dashboard.summary.topicMentions)} note={`${decimal.format(selectedTopic?.share || 0)}% отзывов`} tone="violet" />
        <TopicKpi title="Сантимент" value={hasSentiment ? decimal.format(dashboard.summary.topicScore) : '—'} note={hasSentiment ? '0 — негатив · 100 — позитив' : 'Нет окрашенных совпадений'} tone="yellow" />
        <TopicKpi title="Доля негатива" value={`${decimal.format(dashboard.summary.negativeShare)}%`} note="Негативные совпадения темы" tone="red" />
      </section>

      <section className="page-card cx-sentiment-overview">
        <button type="button" onClick={() => openDrilldown('positive')}><span>Позитив</span><strong>{decimal.format(dashboard.summary.positiveShare)}%</strong><small>Показать отзывы</small></button>
        <button type="button" onClick={() => openDrilldown('neutral')}><span>Нейтрально</span><strong>{decimal.format(dashboard.summary.neutralShare)}%</strong><small>Показать отзывы</small></button>
        <button type="button" onClick={() => openDrilldown('negative')}><span>Негатив</span><strong>{decimal.format(dashboard.summary.negativeShare)}%</strong><small>Показать отзывы</small></button>
        <i aria-label="Распределение тональности">
          <b className="positive" style={{ width: `${dashboard.summary.positiveShare}%` }} />
          <b className="neutral" style={{ width: `${dashboard.summary.neutralShare}%` }} />
          <b className="negative" style={{ width: `${dashboard.summary.negativeShare}%` }} />
        </i>
        <small>{hasSentiment
          ? 'Сантимент определяется автоматически по тональным словам рядом с упоминанием темы; отрицания меняют полярность.'
          : 'В контексте найденных тем пока нет слов из тонального словаря. Сантимент не рассчитывается как условные 50 баллов.'}</small>
      </section>

      <section className="cx-topic-analytics-grid">
        <article className="page-card cx-section cx-topic-ranking">
          <div className="cx-section-head"><div><span>СТРУКТУРА</span><h2>Темы отзывов</h2><p>Выберите тему для детализации</p></div></div>
          <div className="cx-topic-ranking-list">
            {dashboard.topics.map(topic => (
              <button key={topic.id} type="button" className={topic.id === selectedTopic?.id ? 'active' : ''} onClick={() => { setLoading(true); setSelectedTopicId(topic.id); }}>
                <span><small>{topic.groupName}</small><strong>{topic.name}</strong></span>
                <span><strong>{integer.format(topic.reviewCount)}</strong><small>{topic.positiveShare > 0 || topic.negativeShare > 0 ? `нег. ${decimal.format(topic.negativeShare)}%` : 'сант. —'}</small></span>
                <i><b style={{ width: `${Math.min(100, topic.share)}%` }} /></i>
              </button>
            ))}
            {!loading && dashboard.topics.length === 0 && <div className="cx-settings-empty">В опубликованном словаре нет активных тем</div>}
          </div>
        </article>

        <article className="page-card cx-section cx-topic-trend">
          <div className="cx-section-head">
            <div><span>ДИНАМИКА</span><h2>Упоминания и тональность по дням</h2><p>{selectedTopic?.name || 'Все темы'}</p></div>
          </div>
          <div className="cx-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dashboard.trend} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#E7EDF4" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={day} tick={{ fontSize: 10, fill: '#7D8DA3' }} />
                <YAxis yAxisId="mentions" tick={{ fontSize: 10, fill: '#7D8DA3' }} width={40} />
                <YAxis yAxisId="negative" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10, fill: '#7D8DA3' }} width={38} />
                <Tooltip labelFormatter={value => day(String(value))} formatter={(value, name) => name === 'Упоминания' ? integer.format(Number(value)) : `${decimal.format(Number(value))}%`} />
                <Bar yAxisId="mentions" dataKey="mentions" name="Упоминания" fill="#78A8F5" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line yAxisId="negative" dataKey="positiveShare" name="Доля позитива" stroke="#0DA878" strokeWidth={2.2} dot={false} />
                <Line yAxisId="negative" dataKey="negativeShare" name="Доля негатива" stroke="#E45D68" strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="page-card cx-section cx-topic-products">
        <div className="cx-section-head">
          <div><span>ТОВАРЫ</span><h2>Где тема встречается чаще всего</h2><p>Топ-15 товаров по количеству упоминаний</p></div>
        </div>
        <div className="cx-table-wrap">
          <table>
            <thead><tr><th>Товар</th><th>Кабинет</th><th>Упоминания</th><th>Средняя оценка</th><th>Позитив</th><th>Негатив</th></tr></thead>
            <tbody>
              {dashboard.products.map(product => (
                <tr key={product.entityKey}>
                  <td><strong>{product.productName || product.sellerSku || product.wbSku || 'Без названия'}</strong><span>SKU {product.sellerSku || '—'} · WB {product.wbSku || '—'}</span></td>
                  <td>{product.cabinetName}</td>
                  <td><strong>{integer.format(product.mentions)}</strong></td>
                  <td>{decimal.format(product.averageRating)} ★</td>
                  <td>{hasSentiment ? <span className="cx-positive-pill">{decimal.format(product.positiveShare)}%</span> : '—'}</td>
                  <td>{hasSentiment ? <span className="cx-negative-pill">{decimal.format(product.negativeShare)}%</span> : '—'}</td>
                </tr>
              ))}
              {!loading && dashboard.products.length === 0 && <tr><td colSpan={6} className="cx-empty">По выбранной теме пока нет совпадений</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {drilldownSentiment && (
        <div className="cx-drilldown-backdrop" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setDrilldownSentiment(null);
        }}>
          <aside className="cx-drilldown" role="dialog" aria-modal="true" aria-label={sentimentLabels[drilldownSentiment]}>
            <header>
              <div><span>ДЕТАЛИЗАЦИЯ САНТИМЕНТА</span><h2>{sentimentLabels[drilldownSentiment]}</h2><p>{selectedTopic?.name || 'Выбранная тема'} · {integer.format(drilldownTotal)} отзывов</p></div>
              <button type="button" aria-label="Закрыть" onClick={() => setDrilldownSentiment(null)}>×</button>
            </header>
            {drilldownError && <div className="cx-error">{drilldownError}</div>}
            <div className={`cx-drilldown-list${drilldownLoading ? ' loading' : ''}`}>
              {drilldownRows.map(review => <TopicReviewCard key={review.id} review={review} />)}
              {!drilldownLoading && !drilldownError && drilldownRows.length === 0 && <div className="cx-drilldown-empty">Отзывов с таким сантиментом в выбранном срезе нет</div>}
            </div>
            <footer>
              <span>{drilldownTotal > 0 ? `${drilldownPage * DRILLDOWN_PAGE_SIZE + 1}–${Math.min(drilldownTotal, (drilldownPage + 1) * DRILLDOWN_PAGE_SIZE)} из ${integer.format(drilldownTotal)}` : '0 отзывов'}</span>
              <div><button type="button" disabled={drilldownPage === 0 || drilldownLoading} onClick={() => setDrilldownPage(value => Math.max(0, value - 1))}>Назад</button><button type="button" disabled={(drilldownPage + 1) * DRILLDOWN_PAGE_SIZE >= drilldownTotal || drilldownLoading} onClick={() => setDrilldownPage(value => value + 1)}>Далее</button></div>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}

function TopicReviewCard({ review }: { review: CxTopicReviewRow }) {
  return <article className="cx-drilldown-review">
    <div className="cx-drilldown-review-head">
      <div><strong>{review.productName || review.sellerSku || 'Без названия'}</strong><span>SKU {review.sellerSku || '—'} · WB {review.wbSku || '—'} · {review.cabinetName}</span></div>
      <div><span className={`cx-rating-pill rating-${review.rating}`}>{review.rating} ★</span><time>{day(review.reviewDate)}</time></div>
    </div>
    <p>{review.reviewText || 'Основной текст отсутствует'}</p>
    {(review.advantages || review.disadvantages) && <div className="cx-drilldown-fragments">
      {review.advantages && <span><b>Достоинства</b>{review.advantages}</span>}
      {review.disadvantages && <span><b>Недостатки</b>{review.disadvantages}</span>}
    </div>}
    <div className="cx-drilldown-rules"><span>Сработали:</span>{review.matchedRules.map(rule => <b key={rule.id}>{rule.pattern}</b>)}</div>
  </article>;
}

function TopicKpi({ title, value, note, tone }: { title: string; value: string; note: string; tone: string }) {
  return <article className={`page-card cx-topic-kpi cx-tone-${tone}`}><span>{title}</span><strong>{value}</strong><small>{note}</small><i /></article>;
}
