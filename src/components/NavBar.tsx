import { useState, useRef, useEffect } from 'react';
import type { PageName } from '../types';

interface NavBarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
  onLogout?: () => void;
  showAdmin?: boolean;
}

interface DropdownGroup {
  label: string;
  items: { page: PageName; label: string }[];
  matchPages: PageName[];
}

const GROUPS: DropdownGroup[] = [
  {
    label: 'Аналитика',
    matchPages: ['funnel', 'entry-points', 'search-phrases'],
    items: [
      { page: 'funnel', label: 'Воронка' },
      { page: 'entry-points', label: 'Точки входа' },
      { page: 'search-phrases', label: 'Поисковые фразы' },
    ],
  },
  {
    label: 'Бизнес-метрики',
    matchPages: ['planning', 'profitability'],
    items: [
      { page: 'planning', label: 'План' },
      { page: 'profitability', label: 'Рентабельность' },
    ],
  },
];

export default function NavBar({ activePage, onNavigate, onLogout, showAdmin }: NavBarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openDropdown) return;
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openDropdown]);

  const navigate = (page: PageName) => {
    setOpenDropdown(null);
    onNavigate(page);
  };

  return (
    <div className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo">Analytics</span>
        <div className="navbar-tabs" ref={dropdownRef}>
          <span
            className={`nav-tab ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('dashboard')}
          >Главная</span>

          {GROUPS.map(g => {
            const groupActive = g.matchPages.includes(activePage);
            const isOpen = openDropdown === g.label;
            return (
              <div className={`nav-dropdown ${isOpen ? 'open' : ''}`} key={g.label}>
                <span
                  className={`nav-tab nav-dropdown-trigger ${groupActive ? 'active' : ''}`}
                  onClick={() => setOpenDropdown(isOpen ? null : g.label)}
                >
                  {g.label}
                  <svg className="nav-dropdown-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
                {isOpen && (
                  <div className="nav-dropdown-menu">
                    {g.items.map(item => (
                      <span
                        key={item.page}
                        className={`nav-dropdown-item ${activePage === item.page ? 'active' : ''}`}
                        onClick={() => navigate(item.page)}
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <span
            className={`nav-tab ${activePage === 'dictionary' ? 'active' : ''}`}
            onClick={() => navigate('dictionary')}
          >Справочник</span>
          <span
            className={`nav-tab ${activePage === 'import' ? 'active' : ''}`}
            onClick={() => navigate('import')}
          >Импорт</span>
          {showAdmin && (
            <span
              className={`nav-tab ${activePage === 'admin' ? 'active' : ''}`}
              onClick={() => navigate('admin')}
            >Админ</span>
          )}
        </div>
      </div>
      <div className="navbar-right">
        <span className="sync-indicator" title="Локальное хранилище">
          <span className="sync-dot online" />
          локально
        </span>
        {onLogout && <button className="nav-logout" onClick={onLogout}>Выход</button>}
      </div>
    </div>
  );
}
