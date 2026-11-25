import { clearMeCache, deleteMe, fetchMe, lastKnownBalance, patchMe } from '../api/me';

const mockRefresh = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../auth/session', () => ({
  supabase: { auth: { refreshSession: (...a: unknown[]) => mockRefresh(...a) } },
  getAccessToken: () => mockGetSession(),
}));

const me = {
  id: '3f2b8c1e-6d7a-4c1b-9f10-2a5d7e8b9c01',
  nickname: 'ana',
  avatarId: 'a01',
  isGuest: true,
  balance: 1234,
  seatedAt: null,
};
const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue('tok');
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

describe('fetchMe', () => {
  it('parses /v1/me and stores the last balance', async () => {
    mockFetch.mockResolvedValue(json(200, me));
    expect(await fetchMe()).toEqual(me);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(await lastKnownBalance()).toBe(1234);
  });

  it('retries once after a 401', async () => {
    mockFetch
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED' } }))
      .mockResolvedValueOnce(json(200, me));
    mockRefresh.mockResolvedValue({ data: { session: { access_token: 'new' } } });
    expect((await fetchMe()).balance).toBe(1234);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('throws on an invalid body', async () => {
    mockFetch.mockResolvedValue(json(200, { ...me, balance: 1.5 }));
    await expect(fetchMe()).rejects.toThrow();
  });
});

describe('patchMe', () => {
  it('sends the patch as JSON and returns the updated profile', async () => {
    mockFetch.mockResolvedValue(json(200, { ...me, nickname: 'beto' }));
    expect((await patchMe({ nickname: 'beto' })).nickname).toBe('beto');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ nickname: 'beto' });
  });

  it('rejects with the server error code', async () => {
    mockFetch.mockResolvedValue(json(409, { error: { code: 'NICKNAME_TAKEN' } }));
    await expect(patchMe({ nickname: 'beto' })).rejects.toThrow('NICKNAME_TAKEN');
  });
});

describe('deleteMe', () => {
  it('sends DELETE with the token and no body', async () => {
    mockFetch.mockResolvedValue(json(204, null));
    await deleteMe();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/v1\/me$/);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('rejects with ACCOUNT_BUSY', async () => {
    mockFetch.mockResolvedValue(json(409, { error: { code: 'ACCOUNT_BUSY' } }));
    await expect(deleteMe()).rejects.toThrow('ACCOUNT_BUSY');
  });

  it('falls back to the HTTP status when the body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(deleteMe()).rejects.toThrow('HTTP_502');
  });
});

describe('clearMeCache', () => {
  it('forgets the last known balance', async () => {
    mockFetch.mockResolvedValue(json(200, me));
    await fetchMe();
    expect(await lastKnownBalance()).toBe(1234);
    clearMeCache();
    expect(await lastKnownBalance()).toBeNull();
  });
});
