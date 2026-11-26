import { findConsumable, type BlindKind, type HandCategory } from '@naipes/engine';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { formatMoney, formatMult, formatNumber } from '@/game/format';
import { BOSS_TEXTS, CONSUMABLE_TEXTS, es, HAND_NAMES } from '@/i18n/es';
import { colors, layout, motion, radii, spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';

export function BlindBar({
  ante,
  blind,
  bossId,
  money,
  onOpenLevels,
}: {
  ante: number;
  blind: BlindKind;
  bossId: string | null;
  money: number;
  onOpenLevels?: () => void;
}) {
  const boss = bossId ? BOSS_TEXTS[bossId] : undefined;
  return (
    <View style={styles.blindBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={es.game.handLevels}
        onPress={onOpenLevels}
        style={styles.blindInfo}
        hitSlop={8}
      >
        <Text variant="caption" tone="muted">
          {es.game.level(ante)} · {boss ? boss.name : es.game.blind[blind]}
        </Text>
        {boss ? (
          <View style={styles.bossChip}>
            <Text variant="caption" tone="mult">
              {boss.rule}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <Text variant="numeric" tone="money" accessibilityLabel={`Dinero ${formatMoney(money)}`}>
        {formatMoney(money)}
      </Text>
    </View>
  );
}

export function ScoreHeader({ score, target }: { score: number; target: number }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(Math.min(1, score / target));
  useEffect(() => {
    progress.value = withTiming(Math.min(1, score / target), {
      duration: reduced ? 0 : motion.duration.slow,
    });
  }, [score, target, reduced, progress]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));
  const done = score >= target;
  return (
    <View
      style={styles.score}
      accessible
      accessibilityLabel={es.game.scoreA11y(formatNumber(score), formatNumber(target))}
      testID="score-header"
    >
      <View style={styles.scoreRow}>
        <Text variant="scoreXL">{formatNumber(score)}</Text>
        <Text variant="caption" tone="muted">
          {es.game.of(formatNumber(target))}
        </Text>
        {done ? (
          <Text variant="bodyMedium" tone="success">
            ✓
          </Text>
        ) : null}
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, bar]} />
      </View>
    </View>
  );
}

export function HandPreview({
  handType,
  level,
  chips,
  mult,
  score,
}: {
  handType: HandCategory | null;
  level?: number;
  chips?: number;
  mult?: number;
  /** Shown at the end of the count. */
  score?: number | null;
}) {
  if (!handType) {
    return (
      <View style={styles.preview}>
        <Text variant="body" tone="muted" center>
          {es.game.pickCards}
        </Text>
      </View>
    );
  }
  const name = HAND_NAMES[handType];
  return (
    <View
      style={styles.preview}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={es.game.previewA11y(
        name,
        formatNumber(chips ?? 0),
        formatMult(mult ?? 0),
      )}
      testID="hand-preview"
    >
      <Text variant="title" center>
        {name}
        {level ? (
          <Text variant="caption" tone="muted">{`  ${es.game.levelShort(level)}`}</Text>
        ) : null}
      </Text>
      <View style={styles.equation}>
        <Text variant="numeric" tone="chips">
          {formatNumber(chips ?? 0)}
        </Text>
        <Text variant="body" tone="muted">
          {` ${es.game.chips}  ${es.game.times}  `}
        </Text>
        <Text variant="numeric" tone="mult">
          {formatMult(mult ?? 0)}
        </Text>
        <Text variant="body" tone="muted">
          {` ${es.game.mult}`}
        </Text>
      </View>
      {score != null ? (
        <Text variant="display" tone="primary" center testID="hand-score">
          {formatNumber(score)}
        </Text>
      ) : null}
    </View>
  );
}

export function ActionBar({
  handsLeft,
  discardsLeft,
  selectedCount,
  busy,
  onPlay,
  onDiscard,
}: {
  handsLeft: number;
  discardsLeft: number;
  selectedCount: number;
  busy: boolean;
  onPlay: () => void;
  onDiscard: () => void;
}) {
  const canPlay = selectedCount > 0 && !busy;
  const canDiscard = selectedCount > 0 && discardsLeft > 0 && !busy;
  return (
    <View style={styles.actions}>
      <Button
        testID="discard-button"
        variant="secondary"
        label={discardsLeft > 0 ? es.game.discard : es.game.noDiscards}
        detail={discardsLeft > 0 ? String(discardsLeft) : undefined}
        accessibilityHint={es.game.discardsLeftA11y(discardsLeft)}
        inactive={!canDiscard}
        onPress={canDiscard ? onDiscard : undefined}
        style={styles.discard}
      />
      <Button
        testID="play-button"
        label={es.game.play}
        detail={String(handsLeft)}
        accessibilityHint={selectedCount > 0 ? es.game.handsLeftA11y(handsLeft) : es.game.pickCards}
        inactive={!canPlay}
        onPress={canPlay ? onPlay : undefined}
        style={styles.play}
      />
    </View>
  );
}

/**
 * Replaces the hand preview while the player picks the cards for a consumable: names the
 * consumable and says how many cards to choose. A frame of its own so it cannot be mistaken
 * for the normal play zone.
 */
export function TargetingPanel({
  consumableId,
  count,
  error,
  limitHit,
}: {
  consumableId: string;
  count: number;
  /** Engine error text for the last Aplicar; shown until the selection changes. */
  error?: string | null;
  /** The player just tried to pick one card more than allowed. */
  limitHit?: boolean;
}) {
  const reduced = useReducedMotion();
  const def = findConsumable(consumableId);
  const name = CONSUMABLE_TEXTS[consumableId]?.name ?? consumableId;
  const { min, max } = def?.targets ?? { min: 0, max: 0 };
  const destroys = !!def?.ops.some((op) => op.op === 'destroyCards');
  return (
    <Animated.View
      entering={
        reduced ? FadeIn.duration(motion.duration.fast) : FadeInDown.duration(motion.duration.base)
      }
      style={styles.panel}
      accessible
      accessibilityLabel={es.consumables.targeting.panelA11y(name, count, max)}
      testID="targeting-panel"
    >
      <Text variant="title" numberOfLines={1}>
        {name}
      </Text>
      <Text
        variant="body"
        tone={error ? 'danger' : limitHit ? 'mult' : 'fg'}
        accessibilityLiveRegion="polite"
        testID="targeting-hint"
      >
        {error ??
          (limitHit
            ? es.consumables.targeting.limit(max)
            : es.consumables.targeting.pick(min, max))}
      </Text>
      {destroys ? (
        <Text variant="caption" tone="danger">
          {es.consumables.targeting.destroyWarning}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/** Replaces Descartar / Jugar mano while picking cards: the hand cannot be played by mistake. */
export function TargetingBar({
  count,
  min,
  max,
  confirming,
  onApply,
  onCancel,
}: {
  count: number;
  min: number;
  max: number;
  /** Destroying cards asks for a second tap: the label changes while armed. */
  confirming?: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const reduced = useReducedMotion();
  const ready = count >= min;
  return (
    <Animated.View
      entering={FadeIn.duration(reduced ? motion.duration.fast : motion.duration.base)}
      style={styles.actions}
      testID="targeting-bar"
    >
      <Button
        testID="targeting-cancel"
        variant="secondary"
        label={es.consumables.targeting.cancel}
        onPress={onCancel}
        style={styles.cancel}
      />
      <Button
        testID="targeting-apply"
        label={
          confirming ? es.consumables.targeting.confirmDestroy : es.consumables.targeting.apply
        }
        detail={confirming ? undefined : `${count}/${max}`}
        accessibilityHint={ready ? undefined : es.consumables.targeting.minHint(min)}
        inactive={!ready}
        onPress={ready ? onApply : undefined}
        style={styles.apply}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    marginHorizontal: layout.gutter,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cancel: { flex: 2, minHeight: layout.actionBarHeight },
  apply: { flex: 3, minHeight: layout.actionBarHeight },
  blindBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    minHeight: 48,
  },
  blindInfo: { flexShrink: 1, gap: spacing.xs, minHeight: 32 },
  bossChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.mult,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  score: { paddingHorizontal: layout.gutter, paddingVertical: spacing.sm, gap: spacing.xs },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { flex: 1, backgroundColor: colors.primary, transformOrigin: 'left' },
  preview: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 96 },
  equation: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.sm,
  },
  discard: { flex: 2, minHeight: layout.actionBarHeight },
  play: { flex: 3, minHeight: layout.actionBarHeight },
});
