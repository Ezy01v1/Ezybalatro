import { fireEvent, render, screen } from '@testing-library/react-native';
import HomeScreen from '@/app/index';
import { useGame } from '@/game/store';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (path: string) => mockPush(path), replace: jest.fn() },
}));

beforeEach(() => {
  mockPush.mockClear();
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

  it('shows "continue" when a run was saved and restores it', async () => {
    useGame.getState().startRun('SAVED-1');
    useGame.setState({ run: null, saveStatus: 'unknown' });
    useGame.getState().hydrate();
    await render(<HomeScreen />);
    expect(screen.getByTestId('continue-run')).toBeTruthy();
    expect(useGame.getState().run?.seed).toBe('SAVED-1');
  });
});
