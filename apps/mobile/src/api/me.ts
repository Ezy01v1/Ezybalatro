import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { meResponseSchema, type MeResponse, type PatchMeRequest } from '@naipes/shared';
import Storage from 'expo-sqlite/kv-store';
import { getAccessToken, supabase } from '../auth/session';
import { config } from '../config';
import { queryClient } from './queryClient';

const BALANCE_KEY = 'me.lastBalance';

async function requestMe(
  method: 'GET' | 'PATCH' | 'DELETE',
  token: string | null,
  body?: unknown,
): Promise<Response> {
  return fetch(`${config.serverUrl}/v1/me`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Calls /v1/me. A 401 refreshes the session and retries once. Throws `Error(code)` on any non-2xx. */
async function callMe(method: 'GET' | 'PATCH' | 'DELETE', body?: unknown): Promise<Response> {
  let res = await requestMe(method, await getAccessToken(), body);
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    res = await requestMe(method, data.session?.access_token ?? null, body);
  }
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    try {
      const parsed = (await res.json()) as { error?: { code?: string } };
      if (parsed.error?.code) code = parsed.error.code;
    } catch {
      // keep the HTTP code
    }
    throw new Error(code);
  }
  return res;
}

function cacheBalance(me: MeResponse): void {
  try {
    Storage.setItemSync(BALANCE_KEY, String(me.balance));
  } catch {
    // the cache is best-effort
  }
}

/** GET /v1/me. A 401 refreshes the session and retries once; any other failure throws. */
export async function fetchMe(): Promise<MeResponse> {
  const me = meResponseSchema.parse(await (await callMe('GET')).json());
  cacheBalance(me);
  return me;
}

/** PATCH /v1/me. Rejects with `Error('NICKNAME_TAKEN' | 'INVALID_REQUEST' | …)`. */
export async function patchMe(patch: PatchMeRequest): Promise<MeResponse> {
  const me = meResponseSchema.parse(await (await callMe('PATCH', patch)).json());
  cacheBalance(me);
  return me;
}

/** DELETE /v1/me (204). Rejects with `Error('ACCOUNT_BUSY' | 'NOT_CONFIGURED' | …)`. */
export async function deleteMe(): Promise<void> {
  await callMe('DELETE');
}

/** Forgets the cached balance (a deleted account must not leak its balance to the next guest). */
export function clearMeCache(): void {
  try {
    Storage.removeItemSync(BALANCE_KEY);
  } catch {
    // best-effort
  }
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
