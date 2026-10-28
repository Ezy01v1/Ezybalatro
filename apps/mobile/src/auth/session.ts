import { AppState } from 'react-native';
import { createClient, type Session } from '@supabase/supabase-js';
import { config } from '../config';
import { chunkedSecureStorage } from './chunkedSecureStorage';

export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    storage: chunkedSecureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

/** Returns the stored session, or signs in as a guest. Null when offline or on failure. */
export async function ensureGuestSession(): Promise<Session | null> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    const { data: created, error } = await supabase.auth.signInAnonymously();
    if (error) return null;
    return created.session;
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function onSessionChange(cb: (token: string | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.access_token ?? null);
  });
  return () => data.subscription.unsubscribe();
}
