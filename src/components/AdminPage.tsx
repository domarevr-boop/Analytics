import { useEffect, useState } from 'react';
import { adminBootstrap, adminMe, createUser, deleteUser, listSessionLogs, listUsers, updateUser, type AdminSessionLogRow, type AdminUserRow } from '../admin/adminApi';
import { getAdminEmail, getCurrentUserEmail, isConfiguredAdminEmail } from '../auth/auth';

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

  useEffect(() => { void load(); }, []);

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
    <div className="admin-page">
      <h2>Админ-панель</h2>
      <div className="admin-meta">
        <div>Админ email: {currentAdminEmail}</div>
        <div>Текущий пользователь: {getCurrentUserEmail() || '—'}</div>
      </div>

      {message && <div className="admin-message">{message}</div>}
      {error && <div className="admin-error">{error}</div>}

      {loading ? <div>Загрузка...</div> : null}

      {adminInfo && !adminInfo.isAdmin && canBootstrap && (
        <section className="admin-block">
          <h3>Первичная активация</h3>
          <p>Пока админов нет. Можно назначить текущий аккаунт админом.</p>
          <button onClick={onBootstrap} disabled={busy}>Сделать себя админом</button>
        </section>
      )}

      <section className="admin-block">
        <h3>Создать аккаунт</h3>
        <input placeholder="email" value={createEmail} onChange={e => setCreateEmail(e.target.value)} />
        <input placeholder="password" type="password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} />
        <button onClick={onCreate} disabled={busy}>Создать</button>
      </section>

      <section className="admin-block">
        <h3>Редактировать аккаунт</h3>
        <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
          <option value="">Выберите пользователя</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.email || u.id}</option>)}
        </select>
        <input placeholder="new email" value={updateEmail} onChange={e => setUpdateEmail(e.target.value)} />
        <input placeholder="new password" type="password" value={updatePassword} onChange={e => setUpdatePassword(e.target.value)} />
        <button onClick={onUpdate} disabled={busy || !selectedUserId}>Сохранить</button>
        <button onClick={onDelete} disabled={busy || !selectedUserId}>Удалить</button>
      </section>

      <section className="admin-block">
        <h3>Пользователи</h3>
        <table>
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
        </table>
      </section>

      <section className="admin-block">
        <h3>Сессии</h3>
        <table>
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
        </table>
      </section>
    </div>
  );
}
