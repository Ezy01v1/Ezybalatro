import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { normalizeSeed } from '@/game/seed';
import { useGame } from '@/game/store';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing, touchTarget, typography } from '@/theme/tokens';
import { Button, DecoRule, Screen, Text } from '@/ui/primitives';

export default function SeedScreen() {
  const startRun = useGame((s) => s.startRun);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const seed = normalizeSeed(text);
    if (!seed) return setError(es.seed.empty);
    startRun(seed);
    router.replace('/run');
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <Text variant="display" accessibilityRole="header">
          {es.seed.title}
        </Text>
        <DecoRule />
        <View style={styles.field}>
          <Text variant="bodyMedium" nativeID="seed-label">
            {es.seed.label}
          </Text>
          <TextInput
            testID="seed-input"
            accessibilityLabelledBy="seed-label"
            accessibilityLabel={es.seed.label}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError(null);
            }}
            placeholder={es.seed.placeholder}
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={32}
            returnKeyType="go"
            onSubmitEditing={submit}
            style={styles.input}
          />
          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              {es.seed.help}
            </Text>
          )}
        </View>
        <Button testID="seed-start" label={es.seed.start} onPress={submit} />
        <Button variant="ghost" label={es.seed.back} onPress={() => router.back()} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: layout.gutter, gap: spacing.lg, paddingTop: spacing.xxl },
  field: { gap: spacing.xs },
  input: {
    ...typography.subtitle,
    color: colors.fg,
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
});
