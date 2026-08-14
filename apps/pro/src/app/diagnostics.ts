import { useEffect, useState } from "react";

export type SanitizedDiagnostic = {
  id: number;
  timestamp: string;
  message: string;
};

const records: SanitizedDiagnostic[] = [];
const listeners = new Set<() => void>();
let sequence = 0;

export function recordSanitizedDiagnostic(cause: unknown): SanitizedDiagnostic {
  const raw = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Unexpected application error";
  const message = raw
    .replaceAll(/(?:[A-Za-z]:\\|\/)[^\s)]+/g, "[local path hidden]")
    .replaceAll(/https?:\/\/[^\s)]+/g, "[address hidden]")
    .replaceAll(/[\r\n\t]+/g, " ")
    .slice(0, 180) || "Unexpected application error";
  const record = { id: ++sequence, timestamp: new Date().toISOString(), message };
  records.unshift(record);
  records.splice(20);
  listeners.forEach((listener) => listener());
  return record;
}

export function installGlobalDiagnostics(onRecord: (record: SanitizedDiagnostic) => void): () => void {
  const onError = (event: ErrorEvent) => onRecord(recordSanitizedDiagnostic(event.error ?? event.message));
  const onRejection = (event: PromiseRejectionEvent) => onRecord(recordSanitizedDiagnostic(event.reason));
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

export function useSanitizedDiagnostics(): readonly SanitizedDiagnostic[] {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return records;
}
