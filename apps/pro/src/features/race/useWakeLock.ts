import { useCallback, useEffect, useRef, useState } from "react";

type WakeLockSentinelLike = { released: boolean; release(): Promise<void>; addEventListener(type: "release", listener: () => void): void };

export type WakeLockState = "off" | "requesting" | "active" | "denied" | "unavailable";

export function useWakeLock() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<WakeLockState>("off");
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  const request = useCallback(async () => {
    const manager = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!manager) { setStatus("unavailable"); return; }
    setStatus("requesting");
    try {
      const lock = await manager.request("screen");
      sentinel.current = lock;
      setStatus("active");
      lock.addEventListener("release", () => { if (document.visibilityState === "visible") setStatus("off"); });
    } catch {
      sentinel.current = null;
      setStatus("denied");
    }
  }, []);

  const release = useCallback(async () => {
    const current = sentinel.current;
    sentinel.current = null;
    if (current && !current.released) await current.release().catch(() => undefined);
    setStatus("off");
  }, []);

  const enable = useCallback(() => { setEnabled(true); void request(); }, [request]);
  const disable = useCallback(() => { setEnabled(false); void release(); }, [release]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!enabled) return;
      if (document.visibilityState === "hidden") void release();
      else void request();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled, release, request]);

  useEffect(() => () => { void sentinel.current?.release(); }, []);
  return { enabled, status, enable, disable };
}
