import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PageName } from './types';
import './styles/design-system.css';
import type { DatePeriod } from './data/mock';
import { getDefaultPeriods } from './data/mock';
import { getAuthState, initAuth, isConfiguredAdminEmail, signOut, subscribeAuth } from './auth/auth';
import { adminMe } from './admin/adminApi';
import { initStore, subscribe, getVersion } from './data/store';
import NavBar from './components/NavBar';
import DashboardBlock from './components/DashboardBlock';
import FilterBar from './components/FilterBar';
import AnalyticsTable, { TABLE_METRIC_GROUPS, type TableMetricKey } from './components/AnalyticsTable';
import MetricColumnPicker from './components/MetricColumnPicker';
import DateRangeFilter from './components/DateRangeFilter';
import PlanningPage from './components/PlanningPage';
import ImportPage from './components/ImportPage';
import DictionaryPage from './components/DictionaryPage';
import ProfitabilityPage from './components/ProfitabilityPage';
import AuthPage from './components/AuthPage';
import AdminPage from './components/AdminPage';
import DevPage from './components/DevPage';
import FunnelPage from './pages/analytics/FunnelPage';
import EntryPointsPage from './pages/analytics/EntryPointsPage';
import SearchPhrasesPage from './pages/analytics/SearchPhrasesPage';
import NicheDynamicsPage from './pages/analytics/NicheDynamicsPage';
import MarketPage from './pages/analytics/MarketPage';
import GeographyPage from './pages/analytics/GeographyPage';
import ClientExperiencePage from './pages/analytics/ClientExperiencePage';
import CompetitorsPage from './pages/analytics/CompetitorsPage';
import ReportingPage from './pages/analytics/ReportingPage';
import ProductOverviewPage from './pages/ProductOverviewPage';
import ChartsBlock from './components/ChartsBlock';
import MiniChartsBlock from './components/MiniChartsBlock';
import { useChartData } from './hooks/useChartData';
import './App.css';
import './styles/overview-pages.css';

const TABLE_METRICS_KEY = 'analytics_table_visible_metrics_v1';
const LAST_PAGE_KEY = 'analytics_last_page_v1';
const ALL_TABLE_METRICS = TABLE_METRIC_GROUPS.flatMap(group => [...group.keys]);
const PAGE_NAMES: PageName[] = ['dashboard', 'import', 'dictionary', 'planning', 'profitability', 'admin', 'dev', 'funnel', 'entry-points', 'search-phrases', 'niche', 'market', 'geography', 'client-experience', 'competitors', 'reporting', 'product'];

function getInitialPage(): PageName {
  if (typeof localStorage === 'undefined') return 'dashboard';
  const savedPage = localStorage.getItem(LAST_PAGE_KEY);
  return PAGE_NAMES.includes(savedPage as PageName) ? savedPage as PageName : 'dashboard';
}

function getInitialTableMetrics(): TableMetricKey[] {
  if (typeof localStorage === 'undefined') return ALL_TABLE_METRICS;
  try {
    const saved = JSON.parse(localStorage.getItem(TABLE_METRICS_KEY) || '[]') as string[];
    const valid = ALL_TABLE_METRICS.filter(metric => saved.includes(metric));
    return valid.length > 0 ? valid : ALL_TABLE_METRICS;
  } catch {
    return ALL_TABLE_METRICS;
  }
}

interface DashboardContentProps {
  cabinetFilter: string;
  categoryFilter: string;
  brandFilter: string;
  groupFilter: string;
  skuFilter: string;
  onCabinetChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onBrandChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onSkuChange: (value: string) => void;
  periodA: DatePeriod;
  periodB: DatePeriod;
  maxDate: string;
  visibleTableMetrics: TableMetricKey[];
  onVisibleTableMetricsChange: (metrics: TableMetricKey[]) => void;
  onPeriodAChange: (period: DatePeriod) => void;
  onPeriodBChange: (period: DatePeriod) => void;
  onProductOpen: (productId: string) => void;
}

function DashboardContent(props: DashboardContentProps) {
  const chartData = useChartData(
    props.periodA.start,
    props.periodA.end,
    props.cabinetFilter,
    props.categoryFilter,
    props.brandFilter,
    props.groupFilter,
    props.skuFilter,
  );
  const filterBarProps = {
    cabinetFilter: props.cabinetFilter,
    categoryFilter: props.categoryFilter,
    brandFilter: props.brandFilter,
    groupFilter: props.groupFilter,
    skuFilter: props.skuFilter,
    onCabinetChange: props.onCabinetChange,
    onCategoryChange: props.onCategoryChange,
    onBrandChange: props.onBrandChange,
    onGroupChange: props.onGroupChange,
    onSkuChange: props.onSkuChange,
    period: props.periodA,
  };
  const exportDashboardData = () => {
    const columns = ['Дата', 'Заказы, ₽', 'Заказы, шт', 'Выручка, ₽', 'Прибыль, ₽', 'Рентабельность, %', 'Расходы на рекламу, ₽', 'ДРР, %'];
    const rows = chartData.map(point => [
      point.date,
      point.values.fact_orders || 0,
      point.values.orders || 0,
      point.values.revenue || 0,
      point.values.profit || 0,
      point.values.margin || 0,
      point.values.ad_spend || 0,
      point.values.drr || 0,
    ]);
    const csv = [columns, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${props.periodA.start}-${props.periodA.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="page-content">
    <section className="dashboard-overview">
      <DashboardBlock
        selectedCategory={props.categoryFilter}
        onCategorySelect={category => {
          props.onCategoryChange(props.categoryFilter === category ? '' : category);
          props.onBrandChange('');
          props.onGroupChange('');
          props.onSkuChange('');
        }}
        onExport={exportDashboardData}
      />
    </section>
    <div className="page-card table-card">
      <div className="table-toolbar">
        <div className="date-filters">
          <DateRangeFilter label="Период" value={props.periodA} onChange={props.onPeriodAChange} maxDate={props.maxDate} />
          <DateRangeFilter label="Сравнение" value={props.periodB} onChange={props.onPeriodBChange} maxDate={props.maxDate} />
        </div>
        <FilterBar
          {...filterBarProps}
          variant="dashboard"
          showCategoryFilter={false}
          afterControls={<MetricColumnPicker selected={props.visibleTableMetrics} onChange={props.onVisibleTableMetricsChange} />}
        />
      </div>
      <AnalyticsTable
        cabinetFilter={props.cabinetFilter}
        categoryFilter={props.categoryFilter}
        brandFilter={props.brandFilter}
        groupFilter={props.groupFilter}
        skuFilter={props.skuFilter}
        periodA={props.periodA}
        periodB={props.periodB}
        visibleMetrics={props.visibleTableMetrics}
        onProductOpen={props.onProductOpen}
      />
    </div>
    <section className="dashboard-insights-grid">
      <div className="page-card overview-chart-card"><ChartsBlock data={chartData} /></div>
      <MiniChartsBlock
        data={chartData}
        periodStart={props.periodA.start}
        periodEnd={props.periodA.end}
        cabinetFilter={props.cabinetFilter}
        categoryFilter={props.categoryFilter}
        brandFilter={props.brandFilter}
        groupFilter={props.groupFilter}
        skuFilter={props.skuFilter}
      />
    </section>
  </div>;
}

function App() {
  const [page, setPage] = useState<PageName>(getInitialPage);
  const [selectedProductId, setSelectedProductId] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('product') || '');
  const [authTick, setAuthTick] = useState(0);
  const auth = getAuthState();

  const [cabinetFilter, setCabinetFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [visibleTableMetrics, setVisibleTableMetrics] = useState<TableMetricKey[]>(getInitialTableMetrics);
  const [periodA, setPeriodA] = useState<DatePeriod>({ start: '', end: '' });
  const [periodB, setPeriodB] = useState<DatePeriod>({ start: '', end: '' });
  const [maxDate, setMaxDate] = useState('');
  const handleVisibleTableMetricsChange = (metrics: TableMetricKey[]) => {
    setVisibleTableMetrics(metrics);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TABLE_METRICS_KEY, JSON.stringify(metrics));
    }
  };
  const filterBarProps = {
    cabinetFilter,
    categoryFilter,
    brandFilter,
    groupFilter,
    skuFilter,
    onCabinetChange: setCabinetFilter,
    onCategoryChange: setCategoryFilter,
    onBrandChange: setBrandFilter,
    onGroupChange: setGroupFilter,
    onSkuChange: setSkuFilter,
  };
  const [allTimeMaxDate, setAllTimeMaxDate] = useState('');
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState('');
  const [adminMeta, setAdminMeta] = useState<{ isAdmin: boolean; adminCount: number; bootstrapAllowed: boolean; email: string | null } | null>(null);

  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const isAdmin = isConfiguredAdminEmail(auth.user?.email) || !!adminMeta?.isAdmin;
  const storeVersion = useSyncExternalStore(subscribe, getVersion);

  useEffect(() => {
    void initAuth();
    const unsubscribe = subscribeAuth(() => setAuthTick(v => v + 1));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_PAGE_KEY, page);
  }, [page]);

  useEffect(() => {
    if (selectedProductId) setPage('product');
  }, []);

  const openProduct = (productId: string) => {
    setSelectedProductId(productId);
    setPage('product');
    const url = new URL(window.location.href);
    url.searchParams.set('product', productId);
    window.history.pushState({}, '', url);
  };

  const closeProduct = () => {
    setSelectedProductId('');
    setPage('dashboard');
    const url = new URL(window.location.href);
    url.searchParams.delete('product');
    window.history.pushState({}, '', url);
  };

  const navigatePage = (nextPage: PageName) => {
    if (nextPage !== 'product' && selectedProductId) {
      setSelectedProductId('');
      const url = new URL(window.location.href);
      url.searchParams.delete('product');
      window.history.pushState({}, '', url);
    }
    setPage(nextPage);
  };

  useEffect(() => {
    const openPlanning = () => setPage('planning');
    window.addEventListener('analytics:open-planning', openPlanning);
    return () => window.removeEventListener('analytics:open-planning', openPlanning);
  }, []);

  useEffect(() => {
    if (!auth.user) {
      setAdminMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await adminMe();
        if (!cancelled) setAdminMeta(me);
      } catch {
        if (!cancelled) setAdminMeta(null);
      }
    })();
    return () => { cancelled = true; };
  }, [auth.user, authTick, adminRefreshKey]);

  useEffect(() => {
    if (!auth.initialized || !auth.user || !isAdmin) {
      setDataReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setDataError('');
        await initStore();
        if (!cancelled) {
          const d = getDefaultPeriods(allTimeMaxDate || undefined);
          if (d.maxDate > allTimeMaxDate) setAllTimeMaxDate(d.maxDate);
          setMaxDate(d.maxDate);
          if (!periodA.start) {
            setPeriodA(d.a);
            setPeriodB(d.b);
          }
          setDataReady(true);
        }
      } catch (e) {
        console.error('[app] initStore failed', e);
        if (!cancelled) setDataError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [auth.initialized, auth.user, isAdmin, authTick]);

  useEffect(() => {
    if (!dataReady || page !== 'dashboard') return;
    const d = getDefaultPeriods(allTimeMaxDate || undefined);
    if (d.maxDate > allTimeMaxDate) setAllTimeMaxDate(d.maxDate);
    setMaxDate(d.maxDate);
  }, [storeVersion, dataReady, page]);

  const handlePeriodAChange = (p: DatePeriod) => {
    if (import.meta.env.DEV) console.log('[APP] handlePeriodAChange', p);
    setPeriodA(p);
  };

  const handlePeriodBChange = (p: DatePeriod) => {
    if (import.meta.env.DEV) console.log('[APP] handlePeriodBChange', p);
    setPeriodB(p);
  };

  if (!auth.initialized || auth.loading) {
    return <div className="dashboard"><div style={{padding: 24}}>Загрузка...</div></div>;
  }

  if (!auth.user) {
    return <AuthPage />;
  }

  const canBootstrap = !!adminMeta?.bootstrapAllowed || isConfiguredAdminEmail(auth.user.email);

  if (!isAdmin && !canBootstrap) {
    return (
      <div className="dashboard">
        <NavBar activePage={page} onNavigate={navigatePage} onLogout={() => void signOut()} showAdmin={false} />
        <div style={{padding: 24}}>Доступ только для админа.</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <NavBar activePage={page} onNavigate={navigatePage} onLogout={() => void signOut()} showAdmin={isAdmin} />

      {!dataReady ? (
        <div className="page-content"><div className="page-card" style={{ padding: 24 }}>
          {dataError ? <><strong>Не удалось загрузить локальные данные</strong><p>{dataError}</p></> : 'Загрузка локальных данных...'}
        </div></div>
      ) : page === 'dashboard' ? (
        <DashboardContent
          cabinetFilter={cabinetFilter}
          categoryFilter={categoryFilter}
          brandFilter={brandFilter}
          groupFilter={groupFilter}
          skuFilter={skuFilter}
          onCabinetChange={setCabinetFilter}
          onCategoryChange={setCategoryFilter}
          onBrandChange={setBrandFilter}
          onGroupChange={setGroupFilter}
          onSkuChange={setSkuFilter}
          periodA={periodA}
          periodB={periodB}
          maxDate={maxDate}
          visibleTableMetrics={visibleTableMetrics}
          onVisibleTableMetricsChange={handleVisibleTableMetricsChange}
          onPeriodAChange={handlePeriodAChange}
          onPeriodBChange={handlePeriodBChange}
          onProductOpen={openProduct}
        />
      ) : page === 'product' && selectedProductId ? (
        <div className="page-content"><ProductOverviewPage productId={selectedProductId} onBack={closeProduct} /></div>
      ) : page === 'funnel' ? (
        <div className="page-content"><FunnelPage /></div>
      ) : page === 'entry-points' ? (
        <div className="page-content"><EntryPointsPage /></div>
      ) : page === 'search-phrases' ? (
        <div className="page-content"><SearchPhrasesPage /></div>
      ) : page === 'niche' ? (
        <div className="page-content"><NicheDynamicsPage /></div>
      ) : page === 'market' ? (
        <div className="page-content"><MarketPage /></div>
      ) : page === 'geography' ? (
        <div className="page-content"><GeographyPage /></div>
      ) : page === 'client-experience' ? (
        <div className="page-content"><ClientExperiencePage /></div>
      ) : page === 'competitors' ? (
        <div className="page-content"><CompetitorsPage /></div>
      ) : page === 'reporting' ? (
        <div className="page-content"><ReportingPage /></div>
      ) : page === 'planning' ? (
        <PlanningPage />
      ) : page === 'import' ? (
        <div className="page-content"><ImportPage /></div>
      ) : page === 'profitability' ? (
        <div className="page-content"><ProfitabilityPage {...filterBarProps} /></div>
      ) : page === 'admin' ? (
        <AdminPage onAdminChanged={() => setAdminRefreshKey(v => v + 1)} />
      ) : page === 'dev' ? (
        <DevPage />
      ) : (
        <DictionaryPage />
      )}
    </div>
  );
}

export default App;
