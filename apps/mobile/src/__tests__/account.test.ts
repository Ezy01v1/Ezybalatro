import { deleteAccount } from '../auth/account';

const calls: string[] = [];
const mockDeleteMe = jest.fn();
const mockClearCache = jest.fn();
const mockClearQueries = jest.fn();
const mockResetTable = jest.fn();
const mockSignOut = jest.fn();
const mockEnsureGuest = jest.fn();

jest.mock('../api/me', () => ({
  deleteMe: () => mockDeleteMe(),
  clearMeCache: () => mockClearCache(),
}));
jest.mock('../api/queryClient', () => ({ queryClient: { clear: () => mockClearQueries() } }));
jest.mock('../table/useTableStore', () => ({
  useTableStore: { getState: () => ({ reset: () => mockResetTable() }) },
}));
jest.mock('../auth/session', () => ({
  supabase: { auth: { signOut: (...a: unknown[]) => mockSignOut(...a) } },
  ensureGuestSession: () => mockEnsureGuest(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  mockDeleteMe.mockImplementation(async () => void calls.push('delete'));
  mockResetTable.mockImplementation(() => void calls.push('table'));
  mockSignOut.mockImplementation(async () => void calls.push('signOut'));
  mockClearCache.mockImplementation(() => void calls.push('cache'));
  mockClearQueries.mockImplementation(() => void calls.push('queries'));
  mockEnsureGuest.mockImplementation(async () => void calls.push('guest'));
});

describe('deleteAccount', () => {
  it('deletes on the server, wipes local state and starts a fresh guest session, in that order', async () => {
    await deleteAccount();
    expect(calls).toEqual(['delete', 'table', 'signOut', 'cache', 'queries', 'guest']);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('leaves everything untouched when the server refuses', async () => {
    mockDeleteMe.mockRejectedValue(new Error('ACCOUNT_BUSY'));
    await expect(deleteAccount()).rejects.toThrow('ACCOUNT_BUSY');
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockClearCache).not.toHaveBeenCalled();
    expect(mockClearQueries).not.toHaveBeenCalled();
    expect(mockEnsureGuest).not.toHaveBeenCalled();
    expect(mockResetTable).not.toHaveBeenCalled();
  });

  it('still finishes the cleanup when the local sign-out throws', async () => {
    mockSignOut.mockRejectedValue(new Error('boom'));
    await deleteAccount();
    expect(mockClearCache).toHaveBeenCalled();
    expect(mockEnsureGuest).toHaveBeenCalled();
  });
});
