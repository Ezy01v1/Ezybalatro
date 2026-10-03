import { ENGINE_VERSION } from '@naipes/engine';
import { SOCKET_EVENTS } from '@naipes/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { es } from '@/i18n/es';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

type ModeButtonProps = {
  label: string;
  hint: string;
  onPress: () => void;
};

function ModeButton({ label, hint, onPress }: ModeButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
      <Text style={styles.buttonHint}>{hint}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  // Phase 0: buttons are intentionally inert. Navigation arrives with each mode.
  const noop = () => {};

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{es.appName}</Text>
        <Text style={styles.subtitle}>{es.home.subtitle}</Text>
      </View>
      <View style={styles.actions}>
        <ModeButton label={es.home.roguelike} hint={es.home.roguelikeHint} onPress={noop} />
        <ModeButton label={es.home.table} hint={es.home.tableHint} onPress={noop} />
      </View>
      <Text style={styles.footer}>
        engine {ENGINE_VERSION} · protocol {Object.keys(SOCKET_EVENTS).length} events
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    justifyContent: 'space-between',
  },
  header: {
    marginTop: spacing.xl * 2,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.fg,
  },
  subtitle: {
    ...typography.body,
    color: colors.muted,
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  button: {
    minHeight: touchTarget * 2,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  buttonLabel: {
    ...typography.button,
    color: colors.fg,
  },
  buttonHint: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  footer: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
