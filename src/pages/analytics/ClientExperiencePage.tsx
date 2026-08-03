import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import DateRangeFilter from '../../components/DateRangeFilter';
import type { DatePeriod } from '../../data/mock';
import {
  getBrands, getCabinets, getGroups, getMemberships, getProducts, getVersion, subscribe,
} from '../../data/store';
import {
  getCxDashboard, getCxDateBounds, getCxReviewsPage,
  type CxDashboard, type CxFilters, type CxReviewRow,
} from '../../features/clientExperience/clientExperienceApi';
import ClientExperienceSettings from '../../features/clientExperience/ClientExperienceSettings';
import ClientExperienceMethodology from '../../features/clientExperience/ClientExperienceMethodology';
import ClientExperienceTopics from '../../features/clientExperience/ClientExperienceTopics';

type ActiveTab = 'overview' | 'topics' | 'reviews' | 'methodology' | 'settings';

const EMPTY_DASHBOARD: CxDashboard = {
  summary: {
    totalReviews: 0, textReviews: 0, emptyReviews: 0, averageRating: 0,
    negativeReviews: 0, answeredReviews: 0, matchedReviews: 0,
  },
  trend: [], ratings: [], problems: [],
};

const numberFormatter = new Intl.NumberFormat('ru-RU');
const decimalFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const PAGE_SIZE = 50;

function percent(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatDate(value: string) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export default function ClientExperiencePage() {
  useSyncExternalStore(subscribe, getVersion);
  const cabinets = getCabinets();
  const brands = getBrands();
  const groups = getGroups();
  const products = getProducts();
  const memberships = getMemberships();
  const [tab, setTab] = useState<ActiveTab>('overview');
  const [bounds, setBounds] = useState({ start: '', end: '' });
  const [period, setPeriod] = useState<DatePeriod>({ start: '', end: '' });
  const [cabinet, setCabinet] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [group, setGroup] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const deferredProductQuery = useDeferredValue(productQuery);
  const [rating, setRating] = useState('');
  const [dashboard, setDashboard] = useState<CxDashboard>(EMPTY_DASHBOARD);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [reviews, setReviews] = useState<CxReviewRow[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewSearchDraft, setReviewSearchDraft] = useState('');
  const [page, setPage] = useState(0);
  const [expandedReview, setExpandedReview] = useState('');
  const [error, setError] = useState('');

  const brandById = useMemo(() => new Map(brands.map(item => [item.id, item.name])), [brands]);
  const groupProductIds = useMemo(() => new Map(
    groups.map(item => [item.id, new Set(memberships.filter(link => link.group_id === item.id).map(link => link.product_id))]),
  ), [groups, memberships]);
  const categories = useMemo(() => [...new Set(products.map(item => item.category).filter(Boolean))].sort(), [products]);

  const productIds = useMemo(() => {
    const needsProductFilter = Boolean(category || brand || group || deferredProductQuery.trim());
    if (!needsProductFilter) return null;
    const query = deferredProductQuery.trim().toLocaleLowerCase('ru-RU');
    return products.filter(product => {
      if (category && product.category !== category) return false;
      if (brand && brandById.get(product.brand_id) !== brand) return false;
      if (group && !groupProductIds.get(group)?.has(product.id)) return false;
      if (!query) return true;
      return [product.name, product.sku, product.wb_sku, ...(product.aliases || [])]
        .some(value => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
    }).map(product => product.id);
  }, [brand, brandById, category, deferredProductQuery, group, groupProductIds, products]);

  const filters = useMemo<CxFilters>(() => ({
    start: period.start,
    end: period.end,
    cabinets: cabinet ? [cabinet] : null,
    productIds,
    rating: rating ? Number(rating) : null,
  }), [cabinet, period, productIds, rating]);

  useEffect(() => {
    let cancelled = false;
    void getCxDateBounds().then(nextBounds => {
      if (cancelled) return;
      setBounds(nextBounds);
      setPeriod(current => current.start ? current : nextBounds);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!filters.start || !filters.end) return;
    let cancelled = false;
    void getCxDashboard(filters).then(data => {
      if (!cancelled) setDashboard(data);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setDashboardLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters]);

  useEffect(() => {
    if (tab !== 'reviews' || !filters.start || !filters.end) return;
    let cancelled = false;
    void getCxReviewsPage(filters, page, PAGE_SIZE, reviewSearch).then(result => {
      if (cancelled) return;
      setReviews(result.rows);
      setReviewsTotal(result.total);
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setReviewsLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters, page, reviewSearch, tab]);

  const summary = dashboard.summary;
  const negativeShare = percent(summary.negativeReviews, summary.totalReviews);
  const textCoverage = percent(summary.textReviews, summary.totalReviews);
  const answeredShare = percent(summary.answeredReviews, summary.textReviews);
  const matchedShare = percent(summary.matchedReviews, summary.totalReviews);
  const pageCount = Math.max(1, Math.ceil(reviewsTotal / PAGE_SIZE));
  const ratingData = [5, 4, 3, 2, 1].map(value => ({
    rating: `${value} ★`,
    count: dashboard.ratings.find(item => item.rating === value)?.reviewCount || 0,
    fill: value >= 4 ? '#12A873' : value === 3 ? '#F3B72C' : '#E45D68',
  }));

  const resetFilters = () => {
    setPeriod(bounds);
    setCabinet('');
    setCategory('');
    setBrand('');
    setGroup('');
    setProductQuery('');
    setRating('');
    setPage(0);
  };

  return (
    <div className="cx-page">
      <header className="analytics-page-title cx-header">
        <div>
          <span>КЛИЕНТСКИЙ ОПЫТ</span>
          <h1>Отзывы покупателей</h1>
          <p>Оценки, динамика негатива и товары, которым требуется внимание.</p>
        </div>
        <div className="cx-tabs" role="tablist">
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Обзор</button>
          <button className={tab === 'topics' ? 'active' : ''} onClick={() => setTab('topics')}>Темы</button>
          <button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>Отзывы</button>
          <button className={tab === 'methodology' ? 'active' : ''} onClick={() => setTab('methodology')}>Методология</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Настройки анализа</button>
        </div>
      </header>

      {tab !== 'methodology' && <section className="page-card cx-toolbar">
        {bounds.end && <DateRangeFilter label="Период" value={period} onChange={value => { setPeriod(value); setPage(0); }} maxDate={bounds.end} />}
        <select value={cabinet} onChange={event => { setCabinet(event.target.value); setPage(0); }}>
          <option value="">Все кабинеты</option>
          {cabinets.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
        </select>
        <select value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}>
          <option value="">Все категории</option>
          {categories.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={brand} onChange={event => { setBrand(event.target.value); setPage(0); }}>
          <option value="">Все бренды</option>
          {brands.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
        </select>
        <select value={group} onChange={event => { setGroup(event.target.value); setPage(0); }}>
          <option value="">Все склейки</option>
          {groups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input value={productQuery} onChange={event => { setProductQuery(event.target.value); setPage(0); }} placeholder="Название, SKU или WB ID" />
        <select value={rating} onChange={event => { setRating(event.target.value); setPage(0); }}>
          <option value="">Все оценки</option>
          {[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} звёзд</option>)}
        </select>
        <button type="button" className="cx-reset" onClick={resetFilters}>Сбросить</button>
      </section>}

      {error && <div className="cx-error">{error}</div>}
      <div className="cx-scope-note">
        {tab === 'methodology'
          ? 'Описание использует текущую опубликованную версию словаря и не зависит от фильтров аналитического среза.'
          : tab === 'topics'
          ? 'Дашборд использует последнюю опубликованную и полностью рассчитанную версию словаря.'
          : 'Оценочный обзор и исходные отзывы. Тематическая аналитика доступна на вкладке «Темы» после публикации словаря.'}
      </div>

      {tab === 'settings' ? <ClientExperienceSettings /> : tab === 'methodology' ? <ClientExperienceMethodology /> : tab === 'topics' ? <ClientExperienceTopics filters={filters} /> : tab === 'overview' ? (
        <>
          <section className={`cx-kpis${dashboardLoading ? ' loading' : ''}`}>
            <Kpi title="Всего отзывов" value={numberFormatter.format(summary.totalReviews)} note={`${numberFormatter.format(summary.textReviews)} с текстом`} tone="blue" />
            <Kpi title="Средняя оценка" value={`${decimalFormatter.format(summary.averageRating)} ★`} note="С учётом пустых отзывов" tone="yellow" />
            <Kpi title="Негатив 1–3★" value={`${decimalFormatter.format(negativeShare)}%`} note={`${numberFormatter.format(summary.negativeReviews)} отзывов`} tone="red" />
            <Kpi title="Покрытие текстом" value={`${decimalFormatter.format(textCoverage)}%`} note={`${numberFormatter.format(summary.emptyReviews)} без текста`} tone="green" />
            <Kpi title="Ответы продавца" value={`${decimalFormatter.format(answeredShare)}%`} note="От отзывов с текстом" tone="violet" />
            <Kpi title="Связано с товаром" value={`${decimalFormatter.format(matchedShare)}%`} note="Готово для аналитики товара" tone="blue" />
          </section>

          <section className="cx-main-grid">
            <article className="page-card cx-section">
              <div className="cx-section-head"><div><span>ДИНАМИКА</span><h2>Отзывы и качество по дням</h2></div></div>
              <div className="cx-chart cx-trend-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dashboard.trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E7EDF4" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={value => String(value).slice(5).split('-').reverse().join('.')} tick={{ fontSize: 10, fill: '#7D8DA3' }} />
                    <YAxis yAxisId="count" tick={{ fontSize: 10, fill: '#7D8DA3' }} width={42} />
                    <YAxis yAxisId="rating" orientation="right" domain={[0, 5]} tick={{ fontSize: 10, fill: '#7D8DA3' }} width={28} />
                    <Tooltip labelFormatter={value => formatDate(String(value))} />
                    <Bar yAxisId="count" dataKey="totalReviews" name="Отзывы" fill="#75A7F7" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    <Line yAxisId="rating" dataKey="averageRating" name="Средняя оценка" stroke="#0DA878" strokeWidth={2.2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="page-card cx-section">
              <div className="cx-section-head"><div><span>СТРУКТУРА</span><h2>Распределение оценок</h2></div></div>
              <div className="cx-chart cx-rating-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ratingData} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="#EDF1F6" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#7D8DA3' }} />
                    <YAxis type="category" dataKey="rating" tick={{ fontSize: 11, fill: '#233B59', fontWeight: 700 }} width={42} />
                    <Tooltip formatter={value => numberFormatter.format(Number(value))} />
                    <Bar dataKey="count" name="Отзывы" radius={[0, 5, 5, 0]}>
                      {ratingData.map(item => <Cell key={item.rating} fill={item.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="page-card cx-section cx-problems">
            <div className="cx-section-head">
              <div><span>ЗОНА ВНИМАНИЯ</span><h2>Товары с высокой долей негативных отзывов</h2></div>
              <small>Показываются товары минимум с 3 отзывами</small>
            </div>
            <div className="cx-table-wrap">
              <table>
                <thead><tr><th>Товар</th><th>Кабинет</th><th>Отзывы</th><th>Средняя оценка</th><th>Негатив</th><th>Доля негатива</th></tr></thead>
                <tbody>
                  {dashboard.problems.map(item => (
                    <tr key={item.entityKey}>
                      <td><strong>{item.productName || item.sellerSku || item.wbSku || 'Без названия'}</strong><span>SKU {item.sellerSku || '—'} · WB {item.wbSku || '—'}</span></td>
                      <td>{item.cabinetName}</td>
                      <td>{numberFormatter.format(item.reviewCount)}</td>
                      <td>{decimalFormatter.format(item.averageRating)} ★</td>
                      <td>{numberFormatter.format(item.negativeReviews)}</td>
                      <td><span className="cx-negative-pill">{decimalFormatter.format(item.negativeShare)}%</span></td>
                    </tr>
                  ))}
                  {!dashboardLoading && dashboard.problems.length === 0 && <tr><td colSpan={6} className="cx-empty">Нет данных для выбранных фильтров</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="page-card cx-section cx-reviews-section">
          <div className="cx-section-head cx-review-head">
            <div><span>СЕРВЕРНАЯ ВЫБОРКА</span><h2>Отзывы покупателей</h2><p>{numberFormatter.format(reviewsTotal)} строк после фильтрации</p></div>
            <form onSubmit={event => { event.preventDefault(); setPage(0); setReviewSearch(reviewSearchDraft); }}>
              <input value={reviewSearchDraft} onChange={event => setReviewSearchDraft(event.target.value)} placeholder="Поиск по тексту, SKU или товару" />
              <button type="submit">Найти</button>
            </form>
          </div>
          <div className="cx-table-wrap cx-review-table-wrap">
            <table>
              <thead><tr><th>Дата</th><th>Товар</th><th>Оценка</th><th>Отзыв</th><th>Кабинет</th><th>Статус</th></tr></thead>
              <tbody>
                {reviews.map(item => (
                  <ReviewTableRows key={item.id} item={item} expanded={expandedReview === item.id} onToggle={() => setExpandedReview(current => current === item.id ? '' : item.id)} />
                ))}
                {!reviewsLoading && reviews.length === 0 && <tr><td colSpan={6} className="cx-empty">Отзывы не найдены</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="cx-pagination">
            <span>Страница {page + 1} из {pageCount}</span>
            <div>
              <button disabled={page === 0 || reviewsLoading} onClick={() => setPage(value => Math.max(0, value - 1))}>Назад</button>
              <button disabled={page + 1 >= pageCount || reviewsLoading} onClick={() => setPage(value => value + 1)}>Далее</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ title, value, note, tone }: { title: string; value: string; note: string; tone: string }) {
  return <article className={`page-card cx-kpi cx-tone-${tone}`}><span>{title}</span><strong>{value}</strong><small>{note}</small><i /></article>;
}

function ReviewTableRows({ item, expanded, onToggle }: { item: CxReviewRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cx-review-row" onClick={onToggle}>
        <td>{formatDate(item.reviewDate)}</td>
        <td><strong>{item.productName || item.sellerSku || 'Без названия'}</strong><span>SKU {item.sellerSku || '—'} · WB {item.wbSku || '—'}</span></td>
        <td><span className={`cx-rating-pill rating-${item.rating}`}>{item.rating} ★</span></td>
        <td><p>{item.reviewText || item.advantages || item.disadvantages || 'Без текста'}</p></td>
        <td>{item.cabinetName}</td>
        <td><span className={item.sellerResponse ? 'cx-status answered' : 'cx-status'}>{item.sellerResponse ? 'Есть ответ' : 'Без ответа'}</span></td>
      </tr>
      {expanded && (
        <tr className="cx-review-details"><td colSpan={6}>
          <div><strong>Достоинства</strong><p>{item.advantages || '—'}</p></div>
          <div><strong>Недостатки</strong><p>{item.disadvantages || '—'}</p></div>
          <div><strong>Ответ продавца</strong><p>{item.sellerResponse || '—'}</p></div>
          <div><strong>Контекст</strong><p>{[item.reportedBrand, item.productCategory, ...item.productGroupNames].filter(Boolean).join(' · ') || '—'} · Полезно: +{item.helpfulUp} / −{item.helpfulDown}</p></div>
        </td></tr>
      )}
    </>
  );
}
