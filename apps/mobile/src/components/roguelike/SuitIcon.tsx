import type { Suit } from '@naipes/engine';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/tokens';

/**
 * Suits are drawn as vectors, never as text: Android renders "♦" and "♥" with the color emoji
 * font (always red), which breaks the 4-color deck (♦ must be blue). Found testing on a Galaxy A56.
 */
const PATHS: Record<Suit, string> = {
  s: 'M12 2C9.2 5.8 4 8.8 4 13a4 4 0 0 0 6.8 2.9L10 22h4l-.8-6.1A4 4 0 0 0 20 13c0-4.2-5.2-7.2-8-11z',
  h: 'M12 21.5S3.5 15.9 3.5 9.8A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.5 2.6c0 6.1-8.5 11.7-8.5 11.7z',
  d: 'M12 1.8L19.2 12 12 22.2 4.8 12z',
  c: 'M12 2.5a3.9 3.9 0 0 0-3.4 5.8A3.9 3.9 0 1 0 10.7 15L10 22h4l-.7-7a3.9 3.9 0 1 0 2.1-6.7A3.9 3.9 0 0 0 12 2.5z',
};

export function SuitIcon({
  suit,
  size,
  color = colors.suit[suit],
}: {
  suit: Suit;
  size: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path d={PATHS[suit]} fill={color} />
    </Svg>
  );
}
