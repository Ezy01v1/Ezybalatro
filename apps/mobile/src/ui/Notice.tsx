import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, motion, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

/** Small pill with a short message ("Vendido por $1"); pair it with `useTransientNotice`. */
export function Notice({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  return (
    // Opacity only, so it is also fine with "reduce motion".
    <Animated.View entering={FadeIn.duration(motion.duration.fast)} style={[styles.pill, style]}>
      <View testID="notice" accessible accessibilityLiveRegion="polite">
        <Text variant="caption" center>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
});
