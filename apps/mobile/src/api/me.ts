import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meResponseSchema, type MeResponse } from '@naipes/shared';
import Storage from 'expo-sqlite/kv-store';
import { getAccessToken, supabase } from '../auth/session';
import { config } from '../config';
import { queryClient } from './queryClient';

const BALANCE_KEY = 'me.lastBalance';

async function requestMe(token: string | null): Promise<Response> {
  return fetch(`${config.serverUrl}/v1/me`, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

/** GET /v1/me. A 401 refreshes the session and retries once; any other failure throws. */
export async function fetchMe(): Promise<MeResponse> {
  let res = await requestMe(await getAccessToken());
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    res = await requestMe(data.session?.access_token ?? null);
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    try {
      const body = (await res.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      // keep the HTTP code
    }
    throw new Error(code);
  }
  const me = meResponseSchema.parse(await res.json());
  try {
    Storage.setItemSync(BALANCE_KEY, String(me.balance));
  } catch {
    // the cache is best-effort
  }
  return me;
}

export function useMe(): UseQueryResult<MeResponse> {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe });
}

export async function lastKnownBalance(): Promise<number | null> {
  try {
    const raw = Storage.getItemSync(BALANCE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function invalidateMe(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ['me'] });
}
