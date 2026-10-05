import type { ReactNode } from 'react';
import {
  Pressable,
  Text as RNText,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, touchTarget, typography } from '@/theme/tokens';

type Variant = keyof typeof typography;
type Tone =
  'fg' | 'muted' | 'primary' | 'chips' | 'mult' | 'money' | 'danger' | 'success' | 'primaryFg';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
  center?: boolean;
}

/** Text that only takes tokens. Scales with the system text size unless capped by the caller. */
export function Text({ variant = 'body', tone = 'fg', center, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        typography[variant] as TextStyle,
        { color: colors[tone] },
        center && styles.center,
        style,
      ]}
    />
  );
}

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  /** Secondary detail shown after the label ("· 3"). */
  detail?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: StyleProp<ViewStyle>;
  /** Visually and semantically disabled but still announced with a reason. */
  inactive?: boolean;
}

export function Button({
  label,
  detail,
  variant = 'primary',
  style,
  inactive,
  disabled,
  ...rest
}: ButtonProps) {
  const off = inactive || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        pressed &&
          !off &&
          (variant === 'primary' ? styles.primaryPressed : styles.secondaryPressed),
        off && styles.inactive,
        style,
      ]}
    >
      <Text
        variant="button"
        tone={variant === 'primary' ? 'primaryFg' : 'fg'}
        center
        numberOfLines={1}
      >
        {label}
        {detail ? (
          <Text
            variant="button"
            tone={variant === 'primary' ? 'primaryFg' : 'muted'}
          >{`  ${detail}`}</Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['top', 'bottom', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

/** Thin brass rule with a centered diamond: the "Gran Salón" ornament. */
export function DecoRule({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[styles.rule, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.ruleLine} />
      <View style={styles.ruleDiamond} />
      <View style={styles.ruleLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  screen: { flex: 1, backgroundColor: colors.bg },
  button: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: { backgroundColor: colors.secondary, borderColor: colors.border },
  secondaryPressed: { backgroundColor: colors.secondaryPressed },
  ghost: { backgroundColor: 'transparent', borderColor: colors.border },
  inactive: { opacity: 0.45 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ruleLine: { flex: 1, height: 1, backgroundColor: colors.primary, opacity: 0.6 },
  ruleDiamond: {
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
});
