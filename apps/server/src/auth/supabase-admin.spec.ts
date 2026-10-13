import { retryAuthDeletions, type AuthAdminPort } from './supabase-admin';

function fakeAccounts(pending: string[]) {
  const marked: string[] = [];
  return {
    marked,
    pendingAuthDeletions: async () => pending.filter((id) => !marked.includes(id)),
    markAuthDeleted: async (id: string) => {
      marked.push(id);
    },
  };
}

describe('retryAuthDeletions', () => {
  it('an Auth deletion that failed once is retried at the next startup, then never again', async () => {
    const accounts = fakeAccounts(['u1', 'u2']);
    let failures = 1;
    const calls: string[] = [];
    const admin: AuthAdminPort = {
      deleteUser: async (id) => {
        calls.push(id);
        if (id === 'u2' && failures-- > 0) throw new Error('Supabase deleteUser failed (status 500)');
      },
    };
    const logger = { log: jest.fn(), warn: jest.fn() };

    expect(await retryAuthDeletions(accounts, admin, logger)).toEqual({ deleted: 1, failed: 1 });
    expect(accounts.marked).toEqual(['u1']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('u2'));

    expect(await retryAuthDeletions(accounts, admin, logger)).toEqual({ deleted: 1, failed: 0 });
    expect(accounts.marked).toEqual(['u1', 'u2']);

    expect(await retryAuthDeletions(accounts, admin, logger)).toEqual({ deleted: 0, failed: 0 });
    expect(calls).toEqual(['u1', 'u2', 'u2']);
  });
});
