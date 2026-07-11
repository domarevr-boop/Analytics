import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PageName } from './types';
import type { DatePeriod } from './data/mock';
import { getDefaultPeriods } from './data/mock';
import { getAuthState, initAuth, isConfiguredAdminEmail, signOut, subscribeAuth } from './auth/auth';
import { adminMe } from './admin/adminApi';
import { initStore, subscribe, getVersion } from './data/store';
import NavBar from './components/NavBar';
import DashboardBlock from './components/DashboardBlock';
import FilterBar from './components/FilterBar';
import AnalyticsTable from './components/AnalyticsTable';
import DateRangeFilter from './components/DateRangeFilter';
import PlanningPage from './components/PlanningPage';
import ImportPage from './components/ImportPage';
import DictionaryPage from './components/DictionaryPage';
import ProfitabilityPage from './components/ProfitabilityPage';
import AuthPage from './components/AuthPage';
import AdminPage from './components/AdminPage';
import FunnelPage from './pages/analytics/FunnelPage';
import EntryPointsPage from './pages/analytics/EntryPointsPage';
import SearchPhrasesPage from './pages/analytics/SearchPhrasesPage';
import './App.css';

function App() {
  const [page, setPage] = useState<PageName>('dashboard');
  const [authTick, setAuthTick] = useState(0);
  const auth = getAuthState();

  const [cabinetFilter, setCabinetFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [periodA, setPeriodA] = useState<DatePeriod>({ start: '', end: '' });
  const [periodB, setPeriodB] = useState<DatePeriod>({ start: '', end: '' });
  const [maxDate, setMaxDate] = useState('');
  const [allTimeMaxDate, setAllTimeMaxDate] = useState('');
  const [dataReady, setDataReady] = useState(false);
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
      }
    })();
    return () => { cancelled = true; };
  }, [auth.initialized, auth.user, isAdmin, authTick]);

  useEffect(() => {
    if (!dataReady) return;
    const d = getDefaultPeriods(allTimeMaxDate || undefined);
    if (d.maxDate > allTimeMaxDate) setAllTimeMaxDate(d.maxDate);
    setMaxDate(d.maxDate);
  }, [storeVersion, dataReady]);

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
        <NavBar activePage={page} onNavigate={setPage} onLogout={() => void signOut()} showAdmin={false} />
        <div style={{padding: 24}}>Доступ только для админа.</div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <NavBar activePage={page} onNavigate={setPage} onLogout={() => void signOut()} showAdmin />

      {page === 'dashboard' ? (
        <div className="page-content">
          {dataReady ? (
            <>
              <div className="page-card">
                <DashboardBlock />
              </div>
              <div className="page-card filters-card">
                <div className="date-filters">
                  <DateRangeFilter label="Период" value={periodA} onChange={handlePeriodAChange} maxDate={maxDate} />
                  <DateRangeFilter label="Сравнение" value={periodB} onChange={handlePeriodBChange} maxDate={maxDate} />
                </div>
                <FilterBar
                  cabinetFilter={cabinetFilter}
                  brandFilter={brandFilter}
                  groupFilter={groupFilter}
                  searchQuery={searchQuery}
                  onCabinetChange={setCabinetFilter}
                  onBrandChange={setBrandFilter}
                  onGroupChange={setGroupFilter}
                  onSearchChange={setSearchQuery}
                />
              </div>
              <div className="page-card table-card">
                <AnalyticsTable
                  cabinetFilter={cabinetFilter}
                  brandFilter={brandFilter}
                  groupFilter={groupFilter}
                  searchQuery={searchQuery}
                  periodA={periodA}
                  periodB={periodB}
                />
              </div>
            </>
          ) : <div style={{padding: 24}}>{isAdmin ? 'Загрузка данных...' : 'Данные загрузятся после назначения администратором на вкладке Admin'}</div>}
        </div>
      ) : page === 'funnel' ? (
        <div className="page-content"><FunnelPage /></div>
      ) : page === 'entry-points' ? (
        <div className="page-content"><EntryPointsPage /></div>
      ) : page === 'search-phrases' ? (
        <div className="page-content"><SearchPhrasesPage /></div>
      ) : page === 'planning' ? (
        <PlanningPage />
      ) : page === 'import' ? (
        <ImportPage />
      ) : page === 'profitability' ? (
        <ProfitabilityPage />
      ) : page === 'admin' ? (
        <AdminPage onAdminChanged={() => setAdminRefreshKey(v => v + 1)} />
      ) : (
        <DictionaryPage />
      )}
    </div>
  );
}

export default App;
