import { StyleSheet, View } from 'react-native';
import { EDITION_TEXTS } from '@/i18n/es';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

/** Accent per edition. The written label is always shown too: color is never the only cue. */
const EDITION_COLOR: Record<string, string> = {
  foil: colors.chips,
  holo: colors.mult,
  poly: colors.primary,
  ample: colors.money,
};

export function editionColor(edition: string): string {
  return EDITION_COLOR[edition] ?? colors.primary;
}

/** The small label of a joker edition ("Lám.", "Aura"…). Decorative: the joker reads its name aloud. */
export function EditionTag({ edition, testID }: { edition: string; testID?: string }) {
  const text = EDITION_TEXTS[edition];
  return (
    <View testID={testID} style={[styles.tag, { borderColor: editionColor(edition) }]}>
      <Text
        variant="caption"
        numberOfLines={1}
        maxFontSizeMultiplier={layout.fixedBoxFontScale}
        style={[styles.text, { color: editionColor(edition) }]}
      >
        {text?.short ?? edition}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
  },
  text: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
});
