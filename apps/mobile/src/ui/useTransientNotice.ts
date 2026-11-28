import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from '@/theme/tokens';

/**
 * A message that disappears by itself: `[message, show]`. Showing a new one (or the same one
 * again) restarts the countdown; the timer is cleared when the component unmounts.
 */
export function useTransientNotice(
  ms: number = motion.noticeMs,
): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessage(null);
      }, ms);
    },
    [ms],
  );

  return [message, show];
}
