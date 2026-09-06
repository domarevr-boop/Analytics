import { useState, useRef, useEffect, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { PageName } from '../types';
import { getVersion, subscribe } from '../data/store';

interface NavBarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
  onLogout?: () => void;
  showAdmin?: boolean;
}

type NavIconName = 'report' | 'reviews' | 'funnel' | 'target' | 'search' | 'geo' | 'competitors' | 'market' | 'plan' | 'profit';

interface NavItem {
  page: PageName;
  label: string;
  description: string;
  icon: NavIconName;
}

interface DropdownGroup {
  label: string;
  items?: NavItem[];
  sections?: { label: string; items: NavItem[] }[];
  matchPages: PageName[];
}

const GROUPS: DropdownGroup[] = [
  {
    label: 'Аналитика',
    matchPages: ['funnel', 'entry-points', 'search-phrases', 'market', 'geography', 'client-experience', 'competitors', 'reporting'],
    sections: [
      {
        label: 'Управление',
        items: [{ page: 'reporting', label: 'Отчётность', description: 'Управленческая сводка', icon: 'report' }],
      },
      {
        label: 'Клиентский опыт',
        items: [{ page: 'client-experience', label: 'Отзывы', description: 'Отзывы, темы и CXI', icon: 'reviews' }],
      },
      {
        label: 'Трафик',
        items: [
          { page: 'funnel', label: 'Воронка', description: 'Путь от показа до заказа', icon: 'funnel' },
          { page: 'entry-points', label: 'Точки входа', description: 'Источники и структура трафика', icon: 'target' },
          { page: 'search-phrases', label: 'Поисковые фразы', description: 'Спрос и эффективность запросов', icon: 'search' },
          { page: 'geography', label: 'География заказов', description: 'Регионы и типы логистики', icon: 'geo' },
        ],
      },
      {
        label: 'Конкуренты и рынок',
        items: [
          { page: 'competitors', label: 'Конкуренты', description: 'Бренды, карточки и позиции', icon: 'competitors' },
          { page: 'market', label: 'Рынок', description: 'Объём, доля и средний чек', icon: 'market' },
        ],
      },
    ],
  },
  {
    label: 'Бизнес-метрики',
    matchPages: ['planning', 'profitability'],
    items: [
      { page: 'planning', label: 'План', description: 'Планирование и сценарии', icon: 'plan' },
      { page: 'profitability', label: 'Рентабельность', description: 'Финансовый результат', icon: 'profit' },
    ],
  },
];

function NavIcon({ name }: { name: NavIconName }) {
  const content = (() => {
    switch (name) {
      case 'report': return <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></>;
      case 'reviews': return <><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></>;
      case 'funnel': return <path d="M4 5h16l-6 7v6l-4 2v-8z"/>;
      case 'target': return <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></>;
      case 'search': return <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>;
      case 'geo': return <><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"/><circle cx="12" cy="10" r="2"/></>;
      case 'competitors': return <><path d="M8 4h8v4a4 4 0 0 1-8 0zM10 14h4M12 12v6M8 20h8"/><path d="M8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3"/></>;
      case 'market': return <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>;
      case 'plan': return <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5"/></>;
      case 'profit': return <><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>;
    }
  })();
  return <svg className="nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
}

export default function NavBar({ activePage, onNavigate, onLogout, showAdmin }: NavBarProps) {
  const version = useSyncExternalStore(subscribe, getVersion);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const estimate = navigator.storage?.estimate;
    if (!estimate) return;
    void estimate.call(navigator.storage).then(result => {
      if (!cancelled && typeof result.usage === 'number') setStorageUsage(result.usage);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [version]);

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

  const focusFirstMenuItem = (menuId: string) => {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`#${menuId} [role="menuitem"]`)?.focus());
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>, menuId: string) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenDropdown(null);
      document.querySelector<HTMLButtonElement>(`[aria-controls="${menuId}"]`)?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (currentIndex + 1 + items.length) % items.length
      : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const renderItem = (item: NavItem) => (
    <button
      type="button"
      role="menuitem"
      key={item.page}
      className={`nav-dropdown-item ${activePage === item.page ? 'active' : ''}`}
      onClick={() => navigate(item.page)}
      aria-current={activePage === item.page ? 'page' : undefined}
    >
      <span className="nav-item-icon-wrap"><NavIcon name={item.icon} /></span>
      <span className="nav-item-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
    </button>
  );

  return (
    <div className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo">Analytics</span>
        <div className="navbar-tabs" ref={dropdownRef}>
          <button
            type="button"
            className={`nav-tab ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('dashboard')}
            aria-current={activePage === 'dashboard' ? 'page' : undefined}
          >Главная</button>

          {GROUPS.map((g, groupIndex) => {
            const groupActive = g.matchPages.includes(activePage);
            const isOpen = openDropdown === g.label;
            const menuId = `nav-menu-${groupIndex}`;
            return (
              <div
                className={`nav-dropdown ${isOpen ? 'open' : ''}`}
                key={g.label}
                onMouseEnter={() => setOpenDropdown(g.label)}
                onMouseLeave={() => setOpenDropdown(current => current === g.label ? null : current)}
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenDropdown(null);
                }}
              >
                <button
                  type="button"
                  className={`nav-tab nav-dropdown-trigger ${groupActive ? 'active' : ''}`}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  aria-controls={menuId}
                  onClick={() => setOpenDropdown(current => current === g.label ? null : g.label)}
                  onFocus={() => setOpenDropdown(g.label)}
                  onKeyDown={event => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setOpenDropdown(g.label);
                      focusFirstMenuItem(menuId);
                    } else if (event.key === 'Escape') {
                      setOpenDropdown(null);
                    }
                  }}
                >
                  {g.label}
                  <svg className="nav-dropdown-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {isOpen && (
                  <div
                    id={menuId}
                    className={`nav-dropdown-menu ${g.sections ? 'nav-dropdown-menu--mega' : ''}`}
                    role="menu"
                    aria-label={g.label}
                    onKeyDown={event => handleMenuKeyDown(event, menuId)}
                  >
                    {g.sections ? g.sections.map(section => (
                      <section className="nav-dropdown-section" key={section.label} aria-label={section.label}>
                        <strong className="nav-dropdown-heading">{section.label}</strong>
                        {section.items.map(renderItem)}
                      </section>
                    )) : g.items?.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className={`nav-tab ${activePage === 'dictionary' ? 'active' : ''}`}
            onClick={() => navigate('dictionary')}
            aria-current={activePage === 'dictionary' ? 'page' : undefined}
          >Справочник</button>
          <button
            type="button"
            className={`nav-tab ${activePage === 'import' ? 'active' : ''}`}
            onClick={() => navigate('import')}
            aria-current={activePage === 'import' ? 'page' : undefined}
          >Импорт</button>
          {showAdmin && (
            <>
              <button
                type="button"
                className={`nav-tab ${activePage === 'admin' ? 'active' : ''}`}
                onClick={() => navigate('admin')}
                aria-current={activePage === 'admin' ? 'page' : undefined}
              >Админ</button>
              <button
                type="button"
                className={`nav-tab ${activePage === 'dev' ? 'active' : ''}`}
                onClick={() => navigate('dev')}
                aria-current={activePage === 'dev' ? 'page' : undefined}
              >Разработка</button>
            </>
          )}
        </div>
      </div>
      <div className="navbar-right">
        <span className="sync-indicator" title="Локальное хранилище">
          <span className="sync-dot online" />
          локально{storageUsage === null ? '' : ` · ${formatBytes(storageUsage)}`}
        </span>
        {onLogout && <button className="nav-logout" onClick={onLogout}>Выход</button>}
      </div>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} MB`;
}
