/**
 * Number formatting for es-419 without depending on Intl (Hermes builds may ship without full ICU):
 * "." for thousands, "," for decimals, scientific notation from a billion on ("1,2e9").
 */
export function formatNumber(value: number, maxDecimals = 0): string {
  if (!Number.isFinite(value)) return '∞';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e9) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = Math.floor((abs / 10 ** exponent) * 10) / 10;
    return `${sign}${String(mantissa).replace('.', ',')}e${exponent}`;
  }
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(abs * factor) / factor;
  const [int, dec] = String(rounded).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped}${dec ? `,${dec}` : ''}`;
}

/** Mult can be fractional after ×mult jokers: show up to one decimal. */
export const formatMult = (value: number) => formatNumber(value, 1);

export const formatMoney = (value: number) => `$${formatNumber(value)}`;
