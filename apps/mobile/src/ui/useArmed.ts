import { useEffect, useState } from 'react';

/**
 * Two-tap confirmation for risky actions (sell a joker, abandon the run): the first tap arms it,
 * the second confirms. It disarms itself after `ms`.
 */
export function useArmed<T = true>(ms = 3000): [T | null, (value: T | null) => void] {
  const [armed, setArmed] = useState<T | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ms);
    return () => clearTimeout(timer);
  }, [armed, ms]);
  return [armed, setArmed];
}
