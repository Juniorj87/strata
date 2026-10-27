import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Load once, then refresh on an interval. `enabled` lets a page skip work
 * until the user asks for it.
 */
export function useAsync<T>(loader: () => Promise<T>, intervalMs = 0, enabled = true): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const activeReq = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const reqId = ++activeReq.current;

    loader()
      .then((result) => {
        if (!alive.current) return;
        if (reqId === activeReq.current) {
          setData(result);
          setError(null);
        } else {
          setData((prev) => (prev === null ? result : prev));
        }
      })
      .catch((err: unknown) => {
        if (!alive.current || reqId !== activeReq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive.current && reqId === activeReq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, refresh };
}
