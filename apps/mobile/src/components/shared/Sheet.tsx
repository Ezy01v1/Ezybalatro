import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { colors, layout, motion, radii, spacing } from '@/theme/tokens';
import { es } from '@/i18n/es';
import { DecoRule, Text } from '@/ui/primitives';

const noop = () => {};

/**
 * Bottom sheet over a dimmed backdrop. Tapping the backdrop closes it when `onClose` is given;
 * without it the sheet cannot be dismissed (the backdrop is hidden from screen readers and the
 * Android back button does nothing).
 */
export function Sheet({
  visible,
  title,
  children,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  onClose?: () => void;
  testID?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose ?? noop}
      statusBarTranslucent
    >
      <View style={styles.root} testID={testID}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={!!onClose}
          accessibilityLabel={onClose ? es.game.close : undefined}
          importantForAccessibility={onClose ? 'auto' : 'no'}
          disabled={!onClose}
        >
          <Animated.View entering={FadeIn.duration(motion.duration.fast)} style={styles.backdrop} />
        </Pressable>
        <Animated.View
          entering={reduced ? FadeIn.duration(120) : SlideInDown.duration(280)}
          style={styles.sheet}
          accessibilityViewIsModal
        >
          <Text variant="title" center accessibilityRole="header">
            {title}
          </Text>
          <DecoRule style={styles.rule} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderColor: colors.primary,
    padding: layout.gutter,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  rule: { marginBottom: spacing.xs },
});
