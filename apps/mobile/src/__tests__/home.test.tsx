import { render, screen } from '@testing-library/react-native';
import HomeScreen from '@/app/index';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View };
});

describe('HomeScreen', () => {
  it('shows both game modes as buttons', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('button', { name: /Roguelike/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mesa/ })).toBeTruthy();
  });
});
