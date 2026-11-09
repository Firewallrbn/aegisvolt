// Tiempo real por polling: el estado de un ambiente cada 2 s y la salud de los tres cada 5 s.
import { useCallback, useEffect, useState } from 'react';
import { ENVS, health, snapshot, type Env, type Snapshot } from './api';

export function useSnapshot(env: Env) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await snapshot(env);
      setData(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [env]);

  useEffect(() => {
    setData(null);
    setError(null);
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  return { data, error, refresh };
}

export function useHealth() {
  const [up, setUp] = useState<Record<Env, boolean | null>>({ dev: null, test: null, prod: null });
  useEffect(() => {
    const check = async () => {
      const r = await Promise.all(ENVS.map(health));
      setUp({ dev: r[0], test: r[1], prod: r[2] });
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);
  return up;
}
