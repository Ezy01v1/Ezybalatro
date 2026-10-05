import type { RunCard } from '@naipes/engine';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import { es, RANK_LABELS, RANK_NAMES, SUIT_NAMES } from '@/i18n/es';
import { colors, layout, motion, radii, typography } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { SuitIcon } from './SuitIcon';

const ease = (points: readonly number[]) =>
  Easing.bezier(points[0]!, points[1]!, points[2]!, points[3]!);

export interface PlayingCardProps {
  card: RunCard;
  width: number;
  height: number;
  /** Left offset inside the hand fan. */
  x: number;
  rotation?: number;
  selected?: boolean;
  debuffed?: boolean;
  /** Dimmed while scoring: played but not part of the hand. */
  dimmed?: boolean;
  /** Changes on every scoring step that involves this card: triggers a pulse. */
  pulseKey?: number;
  /** Position in the deal, for the staggered entrance. */
  dealIndex?: number;
  onPress?: (cardId: string) => void;
}

export const cardA11yLabel = (card: RunCard) =>
  `${RANK_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`;

function PlayingCardComponent({
  card,
  width,
  height,
  x,
  rotation = 0,
  selected = false,
  debuffed = false,
  dimmed = false,
  pulseKey = 0,
  dealIndex = 0,
  onPress,
}: PlayingCardProps) {
  const reduced = useReducedMotion();
  const lift = useSharedValue(selected ? -layout.card.lift : 0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(dimmed ? 0.4 : 1);

  useEffect(() => {
    lift.value = withTiming(selected ? -layout.card.lift : 0, {
      duration: reduced ? 0 : selected ? motion.duration.fast : 100,
      easing: ease(motion.easing.out),
    });
  }, [selected, reduced, lift]);

  useEffect(() => {
    opacity.value = withTiming(dimmed ? 0.4 : 1, { duration: reduced ? 0 : 150 });
  }, [dimmed, reduced, opacity]);

  useEffect(() => {
    if (pulseKey === 0 || reduced) return;
    scale.value = withSequence(
      withTiming(1.12, { duration: 90, easing: ease(motion.easing.out) }),
      withTiming(1, { duration: 90, easing: ease(motion.easing.out) }),
    );
  }, [pulseKey, reduced, scale]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: lift.value },
      { rotate: `${rotation}deg` },
      { scale: scale.value * (selected ? 1.04 : 1) },
    ],
  }));

  const suitColor = colors.suit[card.suit];
  const entering = reduced
    ? FadeIn.duration(120)
    : FadeInDown.duration(motion.duration.base)
        .delay(dealIndex * motion.stagger.deal)
        .easing(ease(motion.easing.out));

  return (
    // Outer view: layout animations (deal in, leave, slide to a new place). Inner view: lift/pulse.
    <Animated.View
      entering={entering}
      exiting={reduced ? undefined : FadeOutUp.duration(200)}
      layout={reduced ? undefined : LinearTransition.duration(200)}
      style={[styles.wrap, { left: x, width, height, top: layout.card.lift }]}
    >
      <Animated.View style={[styles.fill, animated]}>
        <Pressable
          testID={`card-${card.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${cardA11yLabel(card)}${debuffed ? `, ${es.game.debuffed}` : ''}`}
          accessibilityState={{ selected }}
          onPress={onPress ? () => onPress(card.id) : undefined}
          style={[styles.face, selected && styles.faceSelected]}
        >
          <View style={styles.frame} pointerEvents="none" />
          <View style={styles.index} pointerEvents="none">
            <Text
              style={[styles.rank, { color: suitColor }]}
              maxFontSizeMultiplier={layout.fixedBoxFontScale}
            >
              {RANK_LABELS[card.rank]}
            </Text>
            <SuitIcon suit={card.suit} size={Math.round(width * 0.24)} />
          </View>
          <View style={styles.suitBig} pointerEvents="none">
            <SuitIcon suit={card.suit} size={Math.round(width * 0.46)} />
          </View>
          {debuffed ? <DebuffOverlay /> : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/** Diagonal hatching + "⊘": a debuffed card is marked by pattern and symbol, not only by color. */
function DebuffOverlay() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id="hatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <Line x1="0" y1="0" x2="0" y2="8" stroke={colors.card.debuff} strokeWidth="2" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#hatch)" opacity={0.55} />
      </Svg>
      <Text style={styles.debuffMark} maxFontSizeMultiplier={layout.fixedBoxFontScale}>
        ⊘
      </Text>
    </View>
  );
}

export const PlayingCard = memo(PlayingCardComponent);

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  fill: { flex: 1 },
  face: {
    flex: 1,
    backgroundColor: colors.card.face,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.card.edge,
    overflow: 'hidden',
    elevation: 2,
  },
  faceSelected: { borderWidth: 2, borderColor: colors.primary, elevation: 6 },
  frame: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.card.edge,
    borderRadius: radii.card - 2,
  },
  index: { position: 'absolute', top: 5, left: 6, alignItems: 'center', width: 26 },
  rank: { ...typography.cardIndex },
  suitBig: { position: 'absolute', right: 5, bottom: 5 },
  debuffMark: { position: 'absolute', right: 6, top: 4, fontSize: 16, color: colors.card.ink },
});
