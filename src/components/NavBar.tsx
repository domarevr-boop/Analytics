import type { PageName } from '../types';

interface NavBarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
  onLogout?: () => void;
  showAdmin?: boolean;
}

export default function NavBar({ activePage, onNavigate, onLogout, showAdmin }: NavBarProps) {

  return (
    <div className="navbar">
      <div className="navbar-left">
        <span className="navbar-logo">Analytics</span>
        <div className="navbar-tabs">
          <span
            className={`nav-tab ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >Главная</span>
          <span
            className={`nav-tab ${activePage === 'planning' ? 'active' : ''}`}
            onClick={() => onNavigate('planning')}
          >План</span>
          <span
            className={`nav-tab ${activePage === 'profitability' ? 'active' : ''}`}
            onClick={() => onNavigate('profitability')}
          >Рентабельность</span>
          <span className="nav-sep">|</span>
          <span
            className={`nav-tab ${activePage === 'dictionary' ? 'active' : ''}`}
            onClick={() => onNavigate('dictionary')}
          >Справочник</span>
          <span
            className={`nav-tab ${activePage === 'import' ? 'active' : ''}`}
            onClick={() => onNavigate('import')}
          >Импорт</span>
          {showAdmin && (
            <span
              className={`nav-tab ${activePage === 'admin' ? 'active' : ''}`}
              onClick={() => onNavigate('admin')}
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
