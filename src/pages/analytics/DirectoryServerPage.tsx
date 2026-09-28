import { useEffect, useState } from 'react';
import { AnalyticsPageHeader, AnalyticsPanel, AnalyticsToolbar, EmptyState, PanelHeader } from '../../components/AnalyticsPrimitives';
import { loadV5DirectoryFilters, loadV5DirectoryPage } from '../../features/directory/directoryData';
import type { V5DirectoryDimension, V5DirectoryRow } from '../../features/directory/directoryDataCore';

const PAGE_SIZE = 100;
const today = () => new Date().toISOString().slice(0, 10);

function groupLabel(row: V5DirectoryRow): string {
  if (!row.groupKnown) return 'Состав не определён';
  if (row.isUngrouped) return 'Без склейки';
  return row.group?.name || 'Состав не определён';
}

export default function DirectoryServerPage() {
  const [asOf, setAsOf] = useState(today);
  const [cabinetId, setCabinetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [cabinets, setCabinets] = useState<V5DirectoryDimension[]>([]);
  const [rows, setRows] = useState<V5DirectoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setFilterError(''); });
    loadV5DirectoryFilters().then(value => {
      if (active) setCabinets(value.cabinets);
    }).catch(reason => {
      if (active) setFilterError(reason instanceof Error ? reason.message : 'Не удалось загрузить кабинеты');
    });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setLoading(true); setError(''); } });
    loadV5DirectoryPage({ asOf, cabinetId, search, limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then(value => {
      if (!active) return;
      setRows(value.rows);
      setTotalCount(value.totalCount);
    }).catch(reason => {
      if (!active) return;
      setRows([]);
      setTotalCount(0);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить товары');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [asOf, cabinetId, search, page, request]);

  const applySearch = () => { setPage(0); setSearch(searchInput.trim()); };
  const pageCount = Math.ceil(totalCount / PAGE_SIZE);

  return <div className="registry-page analytics-page-shell ds-page registry-design-page">
    <AnalyticsPageHeader eyebrow="Справочник" title="Справочник товаров" description="Серверные товары V5 и фактический состав склеек на выбранную дату." meta={<span className="ds-source-badge">V5 · Supabase</span>} />
    <div className="v5-local-source-notice" role="status">Данные берутся из серверных импортов V5. Редактирование карточек пока недоступно; локальные изменения V4 сюда не записываются.</div>
    {filterError && <div className="v5-local-source-notice" role="alert">Кабинеты не загрузились: {filterError}</div>}
    <AnalyticsPanel className="registry-surface" density="data">
      <div className="registry-panel-heading"><PanelHeader eyebrow="Товарные карточки" title="Серверный реестр" description="Поиск, кабинет и датированный состав склеек" /></div>
      <AnalyticsToolbar className="registry-toolbar" trailing={<span>Найдено: <strong>{totalCount.toLocaleString('ru-RU')}</strong></span>}>
        <input value={searchInput} maxLength={100} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applySearch(); }} placeholder="Артикул продавца, WB ID или название" aria-label="Поиск товара" />
        <button type="button" className="ds-button" onClick={applySearch}>Найти</button>
        <label className="registry-date-filter"><span>Состав на дату</span><input type="date" value={asOf} onChange={event => { setPage(0); setAsOf(event.target.value); }} /></label>
        <select value={cabinetId} aria-label="Кабинет" onChange={event => { setPage(0); setCabinetId(event.target.value); }}><option value="">Все кабинеты</option>{cabinets.map(cabinet => <option key={cabinet.id} value={cabinet.id}>{cabinet.name}</option>)}</select>
      </AnalyticsToolbar>
      {loading ? <EmptyState title="Загрузка справочника V5" description="Получаем ограниченную страницу товаров из Supabase." /> : error ? <EmptyState title="Не удалось загрузить справочник" description={error} action={<button type="button" className="ds-button" onClick={() => setRequest(value => value + 1)}>Повторить</button>} /> : <>
        <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Товар</th><th>Артикул продавца</th><th>WB ID</th><th>Категория</th><th>Бренд</th><th>Кабинет</th><th>Склейка</th><th>Состояние</th></tr></thead><tbody>{rows.map(row => <tr key={row.productId}><td><strong>{row.productName}</strong></td><td>{row.sellerSku || '—'}</td><td>{row.wbSku || '—'}</td><td>{row.category?.name || '—'}</td><td>{row.brand?.name || '—'}</td><td>{row.cabinetName}</td><td>{groupLabel(row)}</td><td>{row.productStatus}</td></tr>)}</tbody></table></div>
        {!rows.length && <EmptyState title="Товары не найдены" description="Измените поиск, кабинет или дату состава." />}
        {pageCount > 1 && <div className="v5-directory-pagination"><button type="button" className="ds-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Назад</button><span>Страница {page + 1} из {pageCount}</span><button type="button" className="ds-button" disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>Далее</button></div>}
      </>}
    </AnalyticsPanel>
  </div>;
}
