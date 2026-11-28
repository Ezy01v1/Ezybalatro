import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

export function ModeCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text variant="subtitle">{title}</Text>
      <Text variant="caption" tone="muted">
        {hint}
      </Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
