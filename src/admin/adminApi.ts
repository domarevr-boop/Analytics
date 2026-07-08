import { supabase } from '../lib/supabaseClient';

async function invokeAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-control', {
    body: { action, ...payload },
  });

  if (error) throw error;
  return data as T;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  updated_at: string | null;
  confirmed_at: string | null;
}

export interface AdminSessionLogRow {
  id: string;
  user_id: string;
  email: string | null;
  event: 'signed_in' | 'signed_out' | 'bootstrap' | 'password_changed' | 'email_changed';
  created_at: string;
}

export async function adminMe() {
  return invokeAdmin<{ isAdmin: boolean; adminCount: number; bootstrapAllowed: boolean; email: string | null }>('me');
}

export async function adminBootstrap() {
  return invokeAdmin<{ ok: boolean }>('bootstrap');
}

export async function listUsers() {
  return invokeAdmin<{ users: AdminUserRow[] }>('list-users');
}

export async function createUser(email: string, password: string) {
  return invokeAdmin<{ ok: boolean }>('create-user', { email, password });
}

export async function updateUser(userId: string, data: { email?: string; password?: string }) {
  return invokeAdmin<{ ok: boolean }>('update-user', { userId, ...data });
}

export async function deleteUser(userId: string) {
  return invokeAdmin<{ ok: boolean }>('delete-user', { userId });
}

export async function listSessionLogs() {
  return invokeAdmin<{ logs: AdminSessionLogRow[] }>('list-sessions');
}

export async function logSessionEvent(event: AdminSessionLogRow['event']) {
  return invokeAdmin<{ ok: boolean }>('log-session-event', { event });
}
