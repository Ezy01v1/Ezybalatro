import { clearMeCache, deleteMe } from '../api/me';
import { queryClient } from '../api/queryClient';
import { useTableStore } from '../table/useTableStore';
import { ensureGuestSession, supabase } from './session';

/**
 * Deletes the account on the server and leaves the app as a first-time install: no session, no
 * cached profile, no table. The roguelike run is local and stays. Ends with a fresh guest session
 * (a no-op that returns null if that sign-in fails: the root layout retries on the next launch).
 *
 * Rejects with `Error(code)` from the server (`ACCOUNT_BUSY`, `NOT_CONFIGURED`, `HTTP_…`) before
 * touching any local state, so a failed delete leaves the account usable.
 */
export async function deleteAccount(): Promise<void> {
  await deleteMe();
  useTableStore.getState().reset();
  // 'local': the Supabase user is already gone, a global sign-out would be rejected.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  clearMeCache();
  queryClient.clear();
  await ensureGuestSession();
}
