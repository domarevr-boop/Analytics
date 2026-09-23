import { useEffect, useState } from 'react';
import { getAuthState } from '../auth/auth';
import { listV5AccessUsers, setV5UserAccess, type V5AccessUserRow } from '../admin/v5AccessAdminApi';
import { AnalyticsPageHeader, AnalyticsPanel, EmptyState, PanelHeader } from './AnalyticsPrimitives';

interface AccessDraft {
  active: boolean;
}

function draftFromUser(user: V5AccessUserRow): AccessDraft {
  return {
    active: user.accessRole ? user.isActive : true,
  };
}

export default function V5AccessAdminPage({ onAccessChanged }: { onAccessChanged?: () => void }) {
  const [users, setUsers] = useState<V5AccessUserRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AccessDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const currentUserId = getAuthState().user?.id || '';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await listV5AccessUsers();
      setUsers(rows);
      setDrafts(Object.fromEntries(rows.map(user => [user.userId, draftFromUser(user)])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить доступы V5');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const updateDraft = (userId: string, patch: Partial<AccessDraft>) => {
    setDrafts(current => ({
      ...current,
      [userId]: { ...(current[userId] || { active: true }), ...patch },
    }));
  };

  const save = async (user: V5AccessUserRow) => {
    const draft = drafts[user.userId] || draftFromUser(user);
    setBusyUserId(user.userId);
    setError('');
    setMessage('');
    try {
      await setV5UserAccess(user.userId, draft.active);
      setMessage(`Доступ ${user.email || user.userId} сохранён.`);
      onAccessChanged?.();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить доступ V5');
    } finally {
      setBusyUserId('');
    }
  };

  return <div className="admin-page analytics-page-shell ds-page admin-design-page">
    <AnalyticsPageHeader eyebrow="Управление V5" title="Доступ пользователей" description="Создайте аккаунт в Supabase Authentication, затем включите ему полный доступ к V5." />
    {message && <div className="admin-message" role="status">{message}</div>}
    {error && <div className="admin-error" role="alert">{error}</div>}
    <AnalyticsPanel className="admin-block admin-table-panel" density="data">
      <div className="admin-panel-heading"><PanelHeader eyebrow="Auth и RLS" title="Пользователи V5" description={`${users.length} ${users.length === 1 ? 'аккаунт' : 'аккаунтов'} в отдельном проекте`} /></div>
      {loading ? <div className="admin-loading" role="status">Загрузка доступов V5…</div> : null}
      <div className="admin-table-wrap"><table>
        <thead><tr><th>Email</th><th>Доступ V5</th><th>Последний вход</th><th></th></tr></thead>
        <tbody>{users.map(user => {
          const draft = drafts[user.userId] || draftFromUser(user);
          const isSelf = user.userId === currentUserId;
          return <tr key={user.userId}>
            <td><strong>{user.email || 'Без email'}</strong><small style={{ display: 'block' }}>{user.userId}</small></td>
            <td><label><input type="checkbox" checked={draft.active} disabled={isSelf || busyUserId === user.userId} onChange={event => updateDraft(user.userId, { active: event.target.checked })} /> Полный доступ</label></td>
            <td>{user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleString('ru-RU') : '—'}</td>
            <td><button type="button" disabled={isSelf || busyUserId === user.userId} onClick={() => void save(user)}>{busyUserId === user.userId ? 'Сохранение…' : 'Сохранить'}</button></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!loading && users.length === 0 && <EmptyState title="Auth-пользователей нет" description="Создайте пользователя в Authentication → Users проекта V5." />}
    </AnalyticsPanel>
  </div>;
}
