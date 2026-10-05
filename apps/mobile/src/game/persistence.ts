import { RUN_STATE_VERSION, type RunState } from '@naipes/engine';
import Storage from 'expo-sqlite/kv-store';

const RUN_KEY = 'roguelike.run';

export type LoadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly run: RunState }
  | { readonly status: 'corrupt' };

/** Loads the run in progress. A save from another schema version or unreadable data is discarded. */
export function loadRun(): LoadResult {
  let raw: string | null;
  try {
    raw = Storage.getItemSync(RUN_KEY);
  } catch {
    return { status: 'corrupt' };
  }
  if (raw === null) return { status: 'none' };
  try {
    const run = JSON.parse(raw) as RunState;
    if (
      run?.version !== RUN_STATE_VERSION ||
      typeof run.seed !== 'string' ||
      !Array.isArray(run.hand)
    ) {
      clearRun();
      return { status: 'corrupt' };
    }
    return run.status === 'in_progress' ? { status: 'ok', run } : (clearRun(), { status: 'none' });
  } catch {
    clearRun();
    return { status: 'corrupt' };
  }
}

/** Saves after every action, so closing the app at any moment keeps the run. */
export function saveRun(run: RunState): void {
  if (run.status === 'in_progress') Storage.setItemSync(RUN_KEY, JSON.stringify(run));
  else clearRun();
}

export function clearRun(): void {
  try {
    Storage.removeItemSync(RUN_KEY);
  } catch {
    // Nothing to clear.
  }
}
