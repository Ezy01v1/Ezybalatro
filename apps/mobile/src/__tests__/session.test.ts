import { ensureGuestSession } from '../auth/session';

const mockGetSession = jest.fn();
const mockSignInAnonymously = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      signInAnonymously: (...a: unknown[]) => mockSignInAnonymously(...a),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  }),
}));
jest.mock('../auth/chunkedSecureStorage', () => ({ chunkedSecureStorage: {} }));

beforeEach(() => jest.clearAllMocks());

describe('ensureGuestSession', () => {
  it('reuses a stored session', async () => {
    const session = { access_token: 'a' };
    mockGetSession.mockResolvedValue({ data: { session } });
    expect(await ensureGuestSession()).toBe(session);
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in anonymously when there is none', async () => {
    const session = { access_token: 'b' };
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockResolvedValue({ data: { session }, error: null });
    expect(await ensureGuestSession()).toBe(session);
  });

  it('returns null instead of throwing when sign-in fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignInAnonymously.mockRejectedValue(new Error('offline'));
    expect(await ensureGuestSession()).toBeNull();
    mockSignInAnonymously.mockResolvedValue({ data: { session: null }, error: new Error('x') });
    expect(await ensureGuestSession()).toBeNull();
  });
});
