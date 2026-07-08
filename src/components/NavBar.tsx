import type { PageName } from '../types';
import type { RepoStatus } from '../database/db';

interface NavBarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
  syncStatus?: RepoStatus;
  onLogout?: () => void;
  showAdmin?: boolean;
}

function formatTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function NavBar({ activePage, onNavigate, syncStatus, onLogout, showAdmin }: NavBarProps) {
  const isOnline = syncStatus?.cloudAvailable ?? false;
  const time = syncStatus?.lastSyncTime ?? null;

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
        <span className="sync-indicator" title={isOnline ? `Облако: ${time ? 'синхронизировано в ' + formatTime(time) : 'доступно'}` : 'Офлайн-режим'}>
          <span className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
          {isOnline ? 'online' : 'offline'}
        </span>
        {onLogout && <button className="nav-logout" onClick={onLogout}>Выход</button>}
      </div>
    </div>
  );
}
