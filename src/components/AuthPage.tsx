import { useState } from 'react';
import { getAdminEmail, signIn, signUp } from '../auth/auth';

export default function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await signIn(email.trim(), password);
        if (signInError) throw signInError;
      } else {
        const adminEmail = getAdminEmail();
        if (adminEmail && email.trim().toLowerCase() !== adminEmail.toLowerCase()) {
          throw new Error(`Регистрация доступна только для admin email: ${adminEmail}`);
        }
        const { error: signUpError } = await signUp(email.trim(), password);
        if (signUpError) throw signUpError;
        setInfo('Аккаунт создан. Теперь войдите с этим email и паролем.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка авторизации');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h2>Вход</h2>
        <div className="auth-tabs">
          <button type="button" className={mode === 'sign-in' ? 'active' : ''} onClick={() => setMode('sign-in')}>Войти</button>
          <button type="button" className={mode === 'sign-up' ? 'active' : ''} onClick={() => setMode('sign-up')}>Создать</button>
        </div>
        <label>
          Email
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required />
        </label>
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        <button type="submit" disabled={busy}>{busy ? '...' : mode === 'sign-in' ? 'Войти' : 'Создать аккаунт'}</button>
      </form>
    </div>
  );
}
