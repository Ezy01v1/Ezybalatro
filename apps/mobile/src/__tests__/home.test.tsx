import { act, fireEvent, render, screen } from '@testing-library/react-native';
import HomeScreen from '@/app/index';
import { useGame } from '@/game/store';
import { colors } from '@/theme/tokens';

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const mockPush = jest.fn();
let mockFocusCallbacks: (() => void)[] = [];
jest.mock('expo-router', () => ({
  router: { push: (path: string) => mockPush(path), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => {
      mockFocusCallbacks.push(cb);
      cb();
    }, [cb]);
  },
}));

let mockNet = { isConnected: true as boolean | null };
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => mockNet }));

let mockMe: { data?: { balance: number }; isPending: boolean } = { isPending: true };
let mockKnown: number | null = null;
const mockInvalidate = jest.fn();
jest.mock('@/api/me', () => ({
  useMe: () => mockMe,
  lastKnownBalance: () => Promise.resolve(mockKnown),
  invalidateMe: () => mockInvalidate(),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockInvalidate.mockClear();
  mockFocusCallbacks = [];
  mockNet = { isConnected: true };
  mockMe = { data: { balance: 10000 }, isPending: false };
  mockKnown = null;
  useGame.getState().exitRun();
});

describe('HomeScreen', () => {
  it('offers a new run and a seeded run; no "continue" without a saved run', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('button', { name: /Nueva run/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Jugar con semilla/ })).toBeTruthy();
    expect(screen.queryByTestId('continue-run')).toBeNull();
  });

  it('starts a new run and opens it', async () => {
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId('new-run'));
    expect(useGame.getState().run?.status).toBe('in_progress');
    expect(mockPush).toHaveBeenCalledWith('/run');
  });

  it('shows "continue" as primary when a run was saved, with "new run" secondary', async () => {
    useGame.getState().startRun('SAVED-1');
    useGame.setState({ run: null, saveStatus: 'unknown' });
    useGame.getState().hydrate();
    await render(<HomeScreen />);
    expect(screen.getByTestId('continue-run')).toBeTruthy();
    expect(screen.getByTestId('new-run')).toBeTruthy();
    expect(screen.getByText(/Run en curso · Nivel \d+/)).toBeTruthy();
    expect(useGame.getState().run?.seed).toBe('SAVED-1');
  });

  it('shows the balance from the server', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('balance-value').props.children).toBe('10.000');
    expect(flat(screen.getByTestId('balance-value').props.style).color).not.toBe(colors.muted);
  });

  it('shows a dash while the balance loads', async () => {
    mockMe = { isPending: true };
    await render(<HomeScreen />);
    expect(screen.getByTestId('balance-value').props.children).toBe('—');
    expect(screen.queryByText('Te damos 10.000 fichas al entrar')).toBeNull();
  });

  it('offline: shows the last known balance, disables the table and says why', async () => {
    mockNet = { isConnected: false };
    mockMe = { isPending: true };
    mockKnown = 8500;
    await render(<HomeScreen />);
    expect(screen.getByTestId('balance-value').props.children).toBe('8.500');
    expect(flat(screen.getByTestId('balance-value').props.style).color).toBe(colors.muted);
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    expect(screen.getByTestId('quick-table').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('quick-table'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('first time without a known balance: welcome message', async () => {
    mockNet = { isConnected: false };
    mockMe = { isPending: true };
    await render(<HomeScreen />);
    expect(screen.getByText('Te damos 10.000 fichas al entrar')).toBeTruthy();
    expect(screen.getByTestId('balance-value').props.children).toBe('—');
  });

  it('opens the profile from the gear', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('settings').props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(screen.getByTestId('settings'));
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('opens the table and refreshes the balance when coming back', async () => {
    await render(<HomeScreen />);
    expect(mockInvalidate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('quick-table'));
    expect(mockPush).toHaveBeenCalledWith('/table');
    await act(async () => {
      mockFocusCallbacks[mockFocusCallbacks.length - 1]!();
    });
    expect(mockInvalidate).toHaveBeenCalledTimes(1);
  });
});
