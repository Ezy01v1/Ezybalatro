import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

export const TOAST_MS = 2500;

/** Short message (action errors); never shows an error code. Dismisses itself. */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <View style={styles.root} pointerEvents="none" accessibilityLiveRegion="polite" testID="toast">
      <Text variant="bodyMedium" center>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 140,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
});
