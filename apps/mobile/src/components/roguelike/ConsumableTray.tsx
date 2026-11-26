import type { RunState } from '@naipes/engine';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn, useReducedMotion } from 'react-native-reanimated';
import { es, CONSUMABLE_TEXTS } from '@/i18n/es';
import { colors, fonts, layout, motion, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

export interface ConsumableTrayProps {
  run: RunState;
  onPress: (instanceId: string) => void;
  /** `compact` in the blind tool row, `wide` in the shop. */
  variant?: 'compact' | 'wide';
  /** Nothing responds (hand being scored, blind beaten, picking cards). */
  disabled?: boolean;
  /** The consumable being used (card-picking mode): highlighted, the rest dimmed. */
  activeId?: string | null;
}

const textFor = (consumableId: string) =>
  CONSUMABLE_TEXTS[consumableId] ?? {
    name: consumableId,
    kind: '',
    short: consumableId,
    description: '',
  };

/**
 * The consumable inventory as fixed horizontal "tickets" (jade border), always showing every slot.
 * Jokers are tall brass cards in their own row; these are short and wide so they never get mixed up.
 */
export function ConsumableTray({
  run,
  onPress,
  variant = 'compact',
  disabled = false,
  activeId = null,
}: ConsumableTrayProps) {
  const reduced = useReducedMotion();
  const wide = variant === 'wide';
  const slots = Array.from({ length: run.config.consumableSlots }, (_, i) => run.consumables[i]);
  return (
    <View
      style={[styles.tray, !wide && styles.trayCompact]}
      testID="consumable-tray"
      accessibilityLabel={es.consumables.trayLabel}
    >
      {slots.map((instance, i) => {
        const n = i + 1;
        const box = [styles.slot, wide ? styles.slotWide : styles.slotCompact];
        if (!instance) {
          return (
            <View
              key={`empty-${n}`}
              testID={`consumable-slot-${n}`}
              accessible
              accessibilityLabel={es.consumables.emptySlot}
              style={[...box, styles.slotEmpty, disabled && styles.dimmed]}
            >
              <Text
                variant="caption"
                tone="muted"
                numberOfLines={1}
                maxFontSizeMultiplier={layout.fixedBoxFontScale}
              >
                {wide ? es.consumables.emptyWide : es.consumables.emptyShort}
              </Text>
            </View>
          );
        }
        const text = textFor(instance.consumableId);
        const active = instance.instanceId === activeId;
        const off = disabled || active;
        return (
          <Animated.View
            key={instance.instanceId}
            style={styles.entering}
            entering={
              !wide
                ? undefined
                : reduced
                  ? FadeIn.duration(motion.duration.fast)
                  : ZoomIn.duration(motion.duration.base)
                      .easing(Easing.bezier(...motion.easing.out))
                      .withInitialValues({ transform: [{ scale: 0.9 }] })
            }
          >
            <Pressable
              testID={`consumable-slot-${n}`}
              accessibilityRole="button"
              accessibilityLabel={`${text.name}: ${text.description}`}
              accessibilityHint={
                disabled ? es.consumables.slotInactiveHint : es.consumables.slotHint
              }
              accessibilityState={{ disabled: off, selected: active }}
              onPress={off ? undefined : () => onPress(instance.instanceId)}
              style={[
                ...box,
                styles.slotFull,
                active && styles.slotActive,
                disabled && !active && styles.dimmed,
              ]}
            >
              {wide ? (
                <>
                  <Text
                    variant="bodyMedium"
                    numberOfLines={2}
                    maxFontSizeMultiplier={layout.fixedBoxFontScale}
                  >
                    {text.name}
                  </Text>
                  <Text
                    variant="caption"
                    tone="muted"
                    numberOfLines={1}
                    maxFontSizeMultiplier={layout.fixedBoxFontScale}
                  >
                    {text.kind}
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    variant="caption"
                    tone="muted"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    maxFontSizeMultiplier={layout.fixedBoxFontScale}
                  >
                    {text.kind}
                  </Text>
                  <Text
                    variant="caption"
                    tone="primary"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    maxFontSizeMultiplier={layout.fixedBoxFontScale}
                    style={styles.short}
                  >
                    {text.short}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: { flexDirection: 'row', gap: spacing.sm },
  // In the blind tool row the tray takes whatever width Ordenar and the deck counter leave.
  trayCompact: { flex: 1 },
  entering: { flex: 1, minWidth: layout.consumableSlot.minWidth },
  slot: {
    flex: 1,
    minWidth: layout.consumableSlot.minWidth,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  slotCompact: { height: layout.consumableSlot.height },
  slotWide: { height: layout.consumableSlot.heightWide },
  slotFull: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.chips },
  slotEmpty: {
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  slotActive: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceRaised,
  },
  dimmed: { opacity: 0.45 },
  short: { fontFamily: fonts.uiBold },
});
