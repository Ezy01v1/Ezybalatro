import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ProfileScreen from '@/app/profile';

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (p: string) => mockReplace(p), back: () => mockBack(), push: jest.fn() },
}));

let mockNet = { isConnected: true as boolean | null };
jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: () => mockNet }));

type MockMe = {
  data?: { nickname: string; balance: number; isGuest: boolean };
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};
let mockMe: MockMe;
const mockPatchMe = jest.fn();
jest.mock('@/api/me', () => ({
  useMe: () => mockMe,
  patchMe: (p: unknown) => mockPatchMe(p),
}));

const mockSetQueryData = jest.fn();
jest.mock('@/api/queryClient', () => ({
  queryClient: { setQueryData: (...a: unknown[]) => mockSetQueryData(...a) },
}));

const mockDeleteAccount = jest.fn();
jest.mock('@/auth/account', () => ({ deleteAccount: () => mockDeleteAccount() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockNet = { isConnected: true };
  mockMe = {
    data: { nickname: 'ana', balance: 8500, isGuest: true },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  };
});

const typeNickname = (text: string) => fireEvent.changeText(screen.getByTestId('nickname-input'), text);

describe('ProfileScreen', () => {
  it('shows nickname, balance and the guest notice', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByTestId('nickname-input').props.value).toBe('ana');
    expect(screen.getByTestId('profile-balance').props.children).toBe('8.500');
    expect(screen.getByText('Cuenta de invitado')).toBeTruthy();
  });

  it('offers a retry when the profile fails to load', async () => {
    mockMe = { isPending: false, isError: true, refetch: jest.fn() };
    await render(<ProfileScreen />);
    expect(screen.getByText('No pudimos cargar tu perfil.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-retry'));
    expect(mockMe.refetch).toHaveBeenCalled();
    expect(screen.queryByTestId('delete-account')).toBeNull();
  });

  describe('nickname', () => {
    it('keeps save disabled until the nickname changes', async () => {
      await render(<ProfileScreen />);
      expect(screen.getByTestId('nickname-save').props.accessibilityState.disabled).toBe(true);
      await typeNickname('beto');
      expect(screen.getByTestId('nickname-save').props.accessibilityState.disabled).toBe(false);
    });

    it('does not call the server with an invalid nickname', async () => {
      await render(<ProfileScreen />);
      await typeNickname('a!');
      await fireEvent.press(screen.getByTestId('nickname-save'));
      expect(mockPatchMe).not.toHaveBeenCalled();
      expect(screen.getByText(/Usa de 3 a 20 letras/)).toBeTruthy();
    });

    it('saves and updates the cached profile', async () => {
      const updated = { nickname: 'beto', balance: 8500, isGuest: true };
      mockPatchMe.mockResolvedValue(updated);
      await render(<ProfileScreen />);
      await typeNickname('beto');
      await fireEvent.press(screen.getByTestId('nickname-save'));
      expect(mockPatchMe).toHaveBeenCalledWith({ nickname: 'beto' });
      expect(mockSetQueryData).toHaveBeenCalledWith(['me'], updated);
      expect(screen.getByText('Apodo guardado')).toBeTruthy();
    });

    it('says when the nickname is taken', async () => {
      mockPatchMe.mockRejectedValue(new Error('NICKNAME_TAKEN'));
      await render(<ProfileScreen />);
      await typeNickname('beto');
      await fireEvent.press(screen.getByTestId('nickname-save'));
      expect(screen.getByText('Ese apodo ya está en uso. Prueba con otro.')).toBeTruthy();
    });

    it('shows a generic message on any other failure', async () => {
      mockPatchMe.mockRejectedValue(new Error('HTTP_500'));
      await render(<ProfileScreen />);
      await typeNickname('beto');
      await fireEvent.press(screen.getByTestId('nickname-save'));
      expect(screen.getByText('No pudimos guardar el apodo. Inténtalo de nuevo.')).toBeTruthy();
    });
  });

  describe('delete account', () => {
    it('asks for confirmation before deleting and can be cancelled', async () => {
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      expect(mockDeleteAccount).not.toHaveBeenCalled();
      expect(screen.getByText(/no se puede deshacer/)).toBeTruthy();
      await fireEvent.press(screen.getByTestId('delete-cancel'));
      expect(screen.getByTestId('delete-account')).toBeTruthy();
      expect(mockDeleteAccount).not.toHaveBeenCalled();
    });

    it('deletes and goes back to the menu', async () => {
      mockDeleteAccount.mockResolvedValue(undefined);
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      await fireEvent.press(screen.getByTestId('delete-confirm'));
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('blocks the screen while deleting', async () => {
      let finish!: () => void;
      mockDeleteAccount.mockReturnValue(new Promise<void>((r) => (finish = r)));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      await fireEvent.press(screen.getByTestId('delete-confirm'));
      expect(screen.getByText('Borrando…')).toBeTruthy();
      expect(screen.getByTestId('delete-confirm').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId('delete-cancel').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId('profile-back').props.accessibilityState.disabled).toBe(true);
      await act(async () => finish());
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('explains ACCOUNT_BUSY and stays on the profile', async () => {
      mockDeleteAccount.mockRejectedValue(new Error('ACCOUNT_BUSY'));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      await fireEvent.press(screen.getByTestId('delete-confirm'));
      expect(screen.getByText(/Estás en una mano en juego/)).toBeTruthy();
      expect(screen.getByTestId('delete-account')).toBeTruthy();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('says so when the network fails', async () => {
      mockDeleteAccount.mockRejectedValue(new TypeError('Network request failed'));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      await fireEvent.press(screen.getByTestId('delete-confirm'));
      expect(screen.getByText('Sin conexión: no se puede borrar la cuenta ahora.')).toBeTruthy();
    });

    it('shows a generic message on any other failure', async () => {
      mockDeleteAccount.mockRejectedValue(new Error('NOT_CONFIGURED'));
      await render(<ProfileScreen />);
      await fireEvent.press(screen.getByTestId('delete-account'));
      await fireEvent.press(screen.getByTestId('delete-confirm'));
      expect(screen.getByText('No pudimos borrar tu cuenta. Inténtalo de nuevo.')).toBeTruthy();
    });

    it('is disabled offline', async () => {
      mockNet = { isConnected: false };
      await render(<ProfileScreen />);
      expect(screen.getByTestId('delete-account').props.accessibilityState.disabled).toBe(true);
      expect(screen.getByTestId('nickname-save').props.accessibilityState.disabled).toBe(true);
    });
  });

  it('goes back to the menu', async () => {
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId('profile-back'));
    expect(mockBack).toHaveBeenCalled();
  });
});
