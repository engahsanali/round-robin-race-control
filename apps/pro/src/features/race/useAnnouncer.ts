import { useCallback, useEffect, useState } from "react";

export function useAnnouncer() {
  const [enabled, setEnabled] = useState(false);
  const available = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

  const disable = useCallback(() => {
    setEnabled(false);
    if (available) window.speechSynthesis.cancel();
  }, [available]);

  const announce = useCallback((fact: string) => {
    if (!enabled || !available) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(fact));
  }, [available, enabled]);

  useEffect(() => () => { if (available) window.speechSynthesis.cancel(); }, [available]);

  return { enabled, available, enable: () => setEnabled(true), disable, announce };
}
