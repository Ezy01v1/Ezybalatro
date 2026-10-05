/* eslint-env jest */
// Reanimated 4 test helpers (animations resolve instantly; timers advance with Jest).
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
require('react-native-reanimated').setUpTests();
require('react-native-gesture-handler/jestSetup');

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// In-memory replacement for the SQLite key-value store used to save the run.
jest.mock('expo-sqlite/kv-store', () => {
  const data = new Map();
  return {
    __esModule: true,
    default: {
      getItemSync: (key) => (data.has(key) ? data.get(key) : null),
      setItemSync: (key, value) => data.set(key, value),
      removeItemSync: (key) => data.delete(key),
      clear: () => data.clear(),
    },
  };
});

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    play: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    remove: jest.fn(),
    volume: 1,
  }),
}));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
    Rigid: 'rigid',
    Soft: 'soft',
  },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
