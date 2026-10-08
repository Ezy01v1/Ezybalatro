import type { Scheduler } from './ports';

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  schedule(ms, fn) {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return { cancel: () => clearTimeout(handle) };
  },
};
