import { useEffect, useState } from 'react';

/** How long "12 minutes ago" may be stale before the page looks again. */
const CLOCK_MS = 60_000;

/** The current time, refreshed once a minute, for relative dates. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
