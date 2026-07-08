import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export interface AuthState {
  initialized: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
}

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.toLowerCase() || '';

let state: AuthState = {
  initialized: false,
  loading: true,
  session: null,
  user: null,
};

const listeners = new Set<() => void>();
let authSubscription: { unsubscribe: () => void } | null = null;

function emit() {
  listeners.forEach(fn => fn());
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAuthState(): AuthState {
  return state;
}

export async function initAuth(): Promise<void> {
  if (state.initialized) return;

  const { data } = await supabase.auth.getSession();
  state = {
    initialized: true,
    loading: false,
    session: data.session ?? null,
    user: data.session?.user ?? null,
  };
  emit();

  authSubscription?.unsubscribe();
  authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
    state = {
      ...state,
      loading: false,
      session: session ?? null,
      user: session?.user ?? null,
    };
    emit();
  }).data.subscription;
}

export async function refreshAuthState(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  state = {
    ...state,
    loading: false,
    session: data.session ?? null,
    user: data.session?.user ?? null,
  };
  emit();
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUp(email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function getCurrentUserId(): string | null {
  return state.user?.id ?? null;
}

export function getCurrentUserEmail(): string | null {
  return state.user?.email ?? null;
}

export function isConfiguredAdminEmail(email?: string | null): boolean {
  if (!email || !ADMIN_EMAIL) return false;
  return email.toLowerCase() === ADMIN_EMAIL;
}

export function isAdminUser(user?: User | null): boolean {
  return isConfiguredAdminEmail(user?.email ?? null);
}

export function getAdminEmail(): string {
  return ADMIN_EMAIL;
}
