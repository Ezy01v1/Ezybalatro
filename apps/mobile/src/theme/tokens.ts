/**
 * Design tokens — direction B "Gran Salón" (docs/design/fase2-roguelike-diseno.md, ADR 0007).
 * Components use these tokens, never raw hex values or magic numbers.
 */
export const colors = {
  bg: '#0E1714',
  surface: '#16231F',
  surfaceRaised: '#1F302A',
  fg: '#F1EBDD',
  muted: '#A9B3A9',
  border: '#2E443C',
  primary: '#C9A35A',
  primaryPressed: '#B08A45',
  primaryFg: '#1E1606',
  secondary: '#1F302A',
  secondaryPressed: '#28403A',
  secondaryFg: '#F1EBDD',
  chips: '#4FB3A1',
  mult: '#E0606F',
  money: '#E7C873',
  success: '#6CC28E',
  danger: '#E5675F',
  focus: '#E7C873',
  card: { face: '#F4EEE0', ink: '#18201D', edge: '#C9A35A', back: '#16231F', debuff: '#7A6F5A' },
  suit: { s: '#18201D', h: '#C8233F', d: '#1A5E9A', c: '#276B43' },
  overlay: 'rgba(5, 10, 8, 0.78)',
} as const;

export const fonts = {
  display: 'BigShouldersDisplay_800ExtraBold',
  displayBold: 'BigShouldersDisplay_700Bold',
  ui: 'Barlow_400Regular',
  uiMedium: 'Barlow_500Medium',
  uiBold: 'Barlow_700Bold',
} as const;

/** Sizes in px at text scale 1.0. Text follows the system text size (allowFontScaling). */
export const typography = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38 },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30 },
  subtitle: { fontFamily: fonts.uiMedium, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.ui, fontSize: 16, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.uiMedium, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
  button: { fontFamily: fonts.uiBold, fontSize: 17, lineHeight: 22 },
  scoreXL: {
    fontFamily: fonts.uiBold,
    fontSize: 32,
    lineHeight: 38,
    fontVariant: ['tabular-nums'],
  },
  numeric: {
    fontFamily: fonts.uiBold,
    fontSize: 20,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
  cardIndex: { fontFamily: fonts.display, fontSize: 19, lineHeight: 20 },
} as const;

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 6, md: 10, lg: 16, card: 6, pill: 999 } as const;
export const elevation = { card: 2, raised: 6, sheet: 12 } as const;

/** Minimum touch target (AA requires 24; 44–48 recommended on touch). */
export const touchTarget = 48;

export const layout = {
  gutter: 16,
  card: { width: 60, height: 84, maxWidth: 72, minVisible: 38, lift: 16 },
  jokerSlot: { width: 58, height: 80 },
  actionBarHeight: 56,
  /** Cards and other fixed-size boxes cap text scaling so they do not overflow. */
  fixedBoxFontScale: 1.2,
} as const;

export const motion = {
  duration: { instant: 0, fast: 120, base: 220, slow: 300, scoreStep: 220, scoreStepMin: 90 },
  /** Cubic-bezier control points for Reanimated `Easing.bezier`. */
  easing: {
    out: [0.22, 1, 0.36, 1],
    inOut: [0.65, 0, 0.35, 1],
    in: [0.55, 0, 1, 0.45],
  },
  spring: { damping: 18, stiffness: 220, mass: 1 },
  stagger: { deal: 40, play: 50, discard: 30 },
  /** The scoring playback never takes longer than this; steps get shorter instead. */
  maxScoringMs: 2500,
} as const;
