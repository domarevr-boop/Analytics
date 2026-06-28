import { useState, useEffect } from 'react';
import type { PageName } from './types';
import type { RepoStatus } from './database/db';
import type { DatePeriod } from './data/mock';
import { getDefaultPeriods } from './data/mock';
import { getSyncStatus } from './database/db';
import NavBar from './components/NavBar';
import DashboardBlock from './components/DashboardBlock';
import FilterBar from './components/FilterBar';
import AnalyticsTable from './components/AnalyticsTable';
import DateRangeFilter from './components/DateRangeFilter';
import PlanningPage from './components/PlanningPage';
import ImportPage from './components/ImportPage';
import DictionaryPage from './components/DictionaryPage';
import DevPage from './components/DevPage';
import './App.css';

function App() {
  const [page, setPage] = useState<PageName>('dashboard');
  const [syncStatus, setSyncStatus] = useState<RepoStatus>(() => getSyncStatus());
  const [cabinetFilter, setCabinetFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const def = getDefaultPeriods();
  const [periodA, setPeriodA] = useState<DatePeriod>(def.a);
  const [periodB, setPeriodB] = useState<DatePeriod>(def.b);

  useEffect(() => {
    const timer = setInterval(() => setSyncStatus(getSyncStatus()), 3000);
    return () => clearInterval(timer);
  }, []);

  const handlePeriodChange = (a: DatePeriod, b: DatePeriod) => {
    setPeriodA(a);
    setPeriodB(b);
  };

  return (
    <div className="dashboard">
      <NavBar activePage={page} onNavigate={setPage} syncStatus={syncStatus} />

      {page === 'dashboard' ? (
        <>
          <DashboardBlock />
          <DateRangeFilter periodA={periodA} periodB={periodB} onChange={handlePeriodChange} />
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
          <AnalyticsTable
            cabinetFilter={cabinetFilter}
            brandFilter={brandFilter}
            groupFilter={groupFilter}
            searchQuery={searchQuery}
            periodA={periodA}
            periodB={periodB}
          />
        </>
      ) : page === 'planning' ? (
        <PlanningPage />
      ) : page === 'import' ? (
        <ImportPage />
      ) : page === 'dev' ? (
        <DevPage />
      ) : (
        <DictionaryPage />
      )}
    </div>
  );
}

export default App;
