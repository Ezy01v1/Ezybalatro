import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

/** Sound never carries information on its own: every sound has a visual counterpart. */
const SOURCES = {
  select: require('../../assets/sfx/select.wav'),
  deal: require('../../assets/sfx/deal.wav'),
  play: require('../../assets/sfx/play.wav'),
  chips: require('../../assets/sfx/chips.wav'),
  mult: require('../../assets/sfx/mult.wav'),
  joker: require('../../assets/sfx/joker.wav'),
  win: require('../../assets/sfx/win.wav'),
  lose: require('../../assets/sfx/lose.wav'),
  coin: require('../../assets/sfx/coin.wav'),
} as const;

export type Sound = keyof typeof SOURCES;

const players = new Map<Sound, AudioPlayer>();

export function playSound(sound: Sound): void {
  try {
    let player = players.get(sound);
    if (!player) {
      player = createAudioPlayer(SOURCES[sound]);
      player.volume = 0.6;
      players.set(sound, player);
    }
    void player.seekTo(0);
    player.play();
  } catch {
    // Audio is optional: a failure must never break the game.
  }
}

const safe = (promise: () => Promise<void>) => {
  try {
    void promise().catch(() => {});
  } catch {
    // Haptics unavailable (simulator, setting off).
  }
};

export const haptics = {
  select: () => safe(() => Haptics.selectionAsync()),
  limit: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  play: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  joker: (multiplies: boolean) =>
    safe(() =>
      Haptics.impactAsync(
        multiplies ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Light,
      ),
    ),
  win: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
