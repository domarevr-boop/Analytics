import { useEffect, useState } from 'react';
import { adminBootstrap, adminMe, createUser, deleteUser, listSessionLogs, listUsers, updateUser, type AdminSessionLogRow, type AdminUserRow } from '../admin/adminApi';
import { getAdminEmail, getCurrentUserEmail, isConfiguredAdminEmail } from '../auth/auth';
import { AnalyticsPageHeader, AnalyticsPanel, EmptyState, PanelHeader } from './AnalyticsPrimitives';

export default function AdminPage({ onAdminChanged }: { onAdminChanged?: () => void }) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [logs, setLogs] = useState<AdminSessionLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [updateEmail, setUpdateEmail] = useState('');
  const [updatePassword, setUpdatePassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [adminInfo, setAdminInfo] = useState<{ isAdmin: boolean; adminCount: number; bootstrapAllowed: boolean; email: string | null } | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const me = await adminMe();
      setAdminInfo(me);
      const [{ users }, { logs }] = await Promise.all([listUsers(), listSessionLogs()]);
      setUsers(users);
      setLogs(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки админ-данных');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const refresh = async () => {
    await load();
  };

  const onBootstrap = async () => {
    setBusy(true);
    setError('');
    try {
      await adminBootstrap();
      setMessage('Админ-права активированы');
      onAdminChanged?.();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось включить админа');
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async () => {
    setBusy(true);
    setError('');
    try {
      await createUser(createEmail.trim(), createPassword);
      setCreateEmail('');
      setCreatePassword('');
      setMessage('Аккаунт создан');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать аккаунт');
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async () => {
    if (!selectedUserId) return;
    setBusy(true);
    setError('');
    try {
      await updateUser(selectedUserId, {
        email: updateEmail.trim() || undefined,
        password: updatePassword || undefined,
      });
      setUpdateEmail('');
      setUpdatePassword('');
      setMessage('Аккаунт обновлён');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить аккаунт');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!selectedUserId) return;
    if (!confirm('Удалить аккаунт?')) return;
    setBusy(true);
    setError('');
    try {
      await deleteUser(selectedUserId);
      setSelectedUserId('');
      setMessage('Аккаунт удалён');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить аккаунт');
    } finally {
      setBusy(false);
    }
  };

  const canBootstrap = adminInfo?.bootstrapAllowed && isConfiguredAdminEmail(getCurrentUserEmail());
  const currentAdminEmail = getAdminEmail() || 'не задан';

  return (
    <div className="admin-page analytics-page-shell ds-page admin-design-page">
      <AnalyticsPageHeader eyebrow="Управление" title="Админ-панель" description="Аккаунты, права доступа и журнал пользовательских сессий." />
      <div className="admin-meta">
        <div><span>Администратор</span><strong>{currentAdminEmail}</strong></div>
        <div><span>Текущий пользователь</span><strong>{getCurrentUserEmail() || '—'}</strong></div>
      </div>

      {message && <div className="admin-message" role="status">{message}</div>}
      {error && <div className="admin-error" role="alert">{error}</div>}

      {loading ? <div className="admin-loading" role="status">Загрузка административных данных…</div> : null}

      {adminInfo && !adminInfo.isAdmin && canBootstrap && (
        <AnalyticsPanel className="admin-block admin-bootstrap">
          <PanelHeader eyebrow="Доступ" title="Первичная активация" />
          <p>Пока админов нет. Можно назначить текущий аккаунт админом.</p>
          <button onClick={onBootstrap} disabled={busy}>Сделать себя админом</button>
        </AnalyticsPanel>
      )}

      <div className="admin-actions-grid">
        <AnalyticsPanel className="admin-block">
          <PanelHeader eyebrow="Аккаунты" title="Создать аккаунт" description="Добавьте пользователя с email и временным паролем." />
          <div className="admin-form">
            <label><span>Email</span><input placeholder="name@example.com" type="email" autoComplete="off" value={createEmail} onChange={e => setCreateEmail(e.target.value)} /></label>
            <label><span>Пароль</span><input placeholder="Временный пароль" type="password" autoComplete="new-password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} /></label>
            <div className="admin-form-actions"><button onClick={onCreate} disabled={busy}>Создать</button></div>
          </div>
        </AnalyticsPanel>

        <AnalyticsPanel className="admin-block">
          <PanelHeader eyebrow="Аккаунты" title="Редактировать аккаунт" description="Измените реквизиты или удалите выбранного пользователя." />
          <div className="admin-form">
            <label><span>Пользователь</span><select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
              <option value="">Выберите пользователя</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.email || u.id}</option>)}
            </select></label>
            <label><span>Новый email</span><input placeholder="Оставьте пустым без изменения" type="email" autoComplete="off" value={updateEmail} onChange={e => setUpdateEmail(e.target.value)} /></label>
            <label><span>Новый пароль</span><input placeholder="Оставьте пустым без изменения" type="password" autoComplete="new-password" value={updatePassword} onChange={e => setUpdatePassword(e.target.value)} /></label>
            <div className="admin-form-actions"><button onClick={onUpdate} disabled={busy || !selectedUserId}>Сохранить</button><button className="admin-delete-action" onClick={onDelete} disabled={busy || !selectedUserId}>Удалить</button></div>
          </div>
        </AnalyticsPanel>
      </div>

      <AnalyticsPanel className="admin-block admin-table-panel" density="data">
        <div className="admin-panel-heading"><PanelHeader eyebrow="Доступ" title="Пользователи" description={`${users.length} аккаунтов`} /></div>
        <div className="admin-table-wrap"><table>
          <thead>
            <tr>
              <th>Email</th><th>Создан</th><th>Последний вход</th><th>Подтверждён</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email || '—'}</td>
                <td>{new Date(u.created_at).toLocaleString('ru-RU')}</td>
                <td>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('ru-RU') : '—'}</td>
                <td>{u.confirmed_at ? new Date(u.confirmed_at).toLocaleString('ru-RU') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!loading && users.length === 0 && <EmptyState title="Пользователей нет" description="Создайте первый аккаунт с помощью формы выше." />}
      </AnalyticsPanel>

      <AnalyticsPanel className="admin-block admin-table-panel" density="data">
        <div className="admin-panel-heading"><PanelHeader eyebrow="Аудит" title="Сессии" description="Последние события входа пользователей" /></div>
        <div className="admin-table-wrap"><table>
          <thead>
            <tr>
              <th>Email</th><th>Событие</th><th>Время</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td>{l.email || '—'}</td>
                <td>{l.event}</td>
                <td>{new Date(l.created_at).toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!loading && logs.length === 0 && <EmptyState title="Событий пока нет" description="Журнал заполнится после пользовательских входов и выходов." />}
      </AnalyticsPanel>
    </div>
  );
}
