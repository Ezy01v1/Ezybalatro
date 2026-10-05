import type { JokerInstance } from '@naipes/engine';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { es, JOKER_TEXTS } from '@/i18n/es';
import { colors, layout, motion, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

const SLOT_GAP = spacing.sm;
const STEP = layout.jokerSlot.width + SLOT_GAP;

export interface JokerRailProps {
  jokers: readonly JokerInstance[];
  slots: number;
  /** instanceId → pulse counter, bumped when a joker triggers while scoring. */
  pulses?: Readonly<Record<string, number>>;
  /** Label floating over a joker while it triggers ("+4 mult"). */
  labels?: Readonly<Record<string, string>>;
  onPressJoker?: (instanceId: string) => void;
  onMove?: (from: number, to: number) => void;
}

export function JokerRail({
  jokers,
  slots,
  pulses = {},
  labels = {},
  onPressJoker,
  onMove,
}: JokerRailProps) {
  const empty = Math.max(0, slots - jokers.length);
  return (
    <View
      style={styles.rail}
      accessibilityLabel={es.game.jokersLabel}
      accessibilityHint={es.game.reorderHint}
    >
      {jokers.map((joker, index) => (
        <JokerSlot
          key={joker.instanceId}
          joker={joker}
          index={index}
          count={jokers.length}
          pulseKey={pulses[joker.instanceId] ?? 0}
          label={labels[joker.instanceId]}
          onPress={onPressJoker}
          onMove={onMove}
        />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <View
          key={`empty-${i}`}
          style={[styles.slot, styles.empty]}
          accessibilityLabel={es.game.emptySlot}
        >
          <Text
            variant="caption"
            tone="muted"
            center
            maxFontSizeMultiplier={layout.fixedBoxFontScale}
          >
            —
          </Text>
        </View>
      ))}
    </View>
  );
}

interface SlotProps {
  joker: JokerInstance;
  index: number;
  count: number;
  pulseKey: number;
  label: string | undefined;
  onPress?: (instanceId: string) => void;
  onMove?: (from: number, to: number) => void;
}

function JokerSlot({ joker, index, count, pulseKey, label, onPress, onMove }: SlotProps) {
  const reduced = useReducedMotion();
  const dragX = useSharedValue(0);
  const lifted = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);
  const text = JOKER_TEXTS[joker.jokerId] ?? { name: joker.jokerId, short: '', description: '' };

  useEffect(() => {
    if (pulseKey === 0) return;
    if (reduced) {
      scale.value = withSequence(
        withTiming(1.04, { duration: 75 }),
        withTiming(1, { duration: 75 }),
      );
      return;
    }
    rotate.value = withSequence(
      withTiming(6, { duration: 60 }),
      withTiming(-6, { duration: 60 }),
      withTiming(6, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
    scale.value = withSequence(
      withTiming(1.1, { duration: 120 }),
      withTiming(1, { duration: 120 }),
    );
  }, [pulseKey, reduced, rotate, scale]);

  const instanceId = joker.instanceId;
  const tap = Gesture.Tap()
    .withTestId(`joker-tap-${instanceId}`)
    .onEnd((_e, success) => {
      if (success && onPress) scheduleOnRN(onPress, instanceId);
    });
  const drag = Gesture.Pan()
    .withTestId(`joker-drag-${instanceId}`)
    .activateAfterLongPress(250)
    .onStart(() => {
      lifted.value = withTiming(1, { duration: 120 });
    })
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      const target = Math.max(0, Math.min(count - 1, index + Math.round(e.translationX / STEP)));
      if (onMove && target !== index) scheduleOnRN(onMove, index, target);
    })
    .onFinalize(() => {
      dragX.value = withSpring(0, motion.spring);
      lifted.value = withTiming(0, { duration: 120 });
    });

  const animated = useAnimatedStyle(() => ({
    zIndex: lifted.value > 0 ? 10 : 0,
    elevation: lifted.value > 0 ? 8 : 2,
    transform: [
      { translateX: dragX.value },
      { rotate: `${rotate.value}deg` },
      { scale: scale.value * (reduced ? 1 : 1 + 0.08 * lifted.value) },
    ],
  }));

  return (
    // Outer view: layout transition when the order changes. Inner view: drag, shake and pulse.
    <Animated.View
      layout={
        reduced
          ? undefined
          : LinearTransition.springify()
              .damping(motion.spring.damping)
              .stiffness(motion.spring.stiffness)
      }
      style={styles.slotWrap}
    >
      <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
        <Animated.View
          testID={`joker-${joker.instanceId}`}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${text.name}: ${text.description}`}
          style={[styles.slot, styles.filled, animated]}
        >
          <View style={styles.slotFrame} pointerEvents="none" />
          <Text
            variant="caption"
            center
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            maxFontSizeMultiplier={layout.fixedBoxFontScale}
            style={styles.name}
          >
            {text.name}
          </Text>
          <Text
            variant="caption"
            tone="primary"
            center
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            maxFontSizeMultiplier={layout.fixedBoxFontScale}
          >
            {text.short}
          </Text>
          {label ? (
            <View style={styles.badge} pointerEvents="none">
              <Text
                variant="caption"
                tone={label.includes('mult') ? 'mult' : label.startsWith('+$') ? 'money' : 'chips'}
                maxFontSizeMultiplier={layout.fixedBoxFontScale}
                style={styles.badgeText}
              >
                {label}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: SLOT_GAP, justifyContent: 'center' },
  slotWrap: { zIndex: 1 },
  slot: {
    width: layout.jokerSlot.width,
    height: layout.jokerSlot.height,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  filled: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primary },
  slotFrame: {
    position: 'absolute',
    top: 3,
    left: 3,
    right: 3,
    bottom: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary,
    borderRadius: radii.md - 3,
    opacity: 0.6,
  },
  name: { fontSize: 12, lineHeight: 14 },
  badge: {
    position: 'absolute',
    top: -12,
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
});
