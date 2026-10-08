export type BotPersonality = 'cautious' | 'normal' | 'aggressive';

export const BOT_PERSONALITY_IDS: readonly BotPersonality[] = ['cautious', 'normal', 'aggressive'];

export interface BotProfile {
  /** Added to the pot-odds threshold for calling: higher = calls less. */
  readonly callMargin: number;
  /** Hand strength from which the bot bets or raises for value. */
  readonly raiseAbove: number;
  /** Percent chance of betting or raising with any hand. */
  readonly bluffPercent: number;
}

export const BOT_PERSONALITIES: Record<BotPersonality, BotProfile> = {
  cautious: { callMargin: 0.1, raiseAbove: 0.8, bluffPercent: 5 },
  normal: { callMargin: 0, raiseAbove: 0.7, bluffPercent: 7 },
  aggressive: { callMargin: -0.08, raiseAbove: 0.58, bluffPercent: 10 },
};
