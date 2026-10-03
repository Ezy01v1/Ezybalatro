/**
 * Placeholder design tokens (ADR 0007). The final values come from `disenador-ui-ux` in Phase 2.
 * Components must use these tokens, never raw hex values or magic numbers.
 */
export const colors = {
  bg: '#0E1116',
  surface: '#171B22',
  fg: '#F2F4F7',
  muted: '#9AA4B2',
  border: '#2A303A',
  primary: '#3FB27F',
  primaryFg: '#0E1116',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  md: 12,
} as const;

export const typography = {
  title: { fontSize: 32, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400' },
  button: { fontSize: 18, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

/** Minimum touch target recommended on mobile. */
export const touchTarget = 48;
