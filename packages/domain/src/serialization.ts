import { validateEventState } from "./schema";
import type { EventStateV1, ValidationIssue } from "./types";

export type EventInterchangeResult =
  | { ok: true; data: EventStateV1 }
  | { ok: false; issues: ValidationIssue[] };

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function serializeEvent(state: EventStateV1): string {
  const validated = validateEventState(state);
  if (!validated.success) {
    const summary = validated.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Cannot serialize invalid event state: ${summary}`);
  }
  return `${JSON.stringify(sortObjectKeys(validated.data), null, 2)}\n`;
}

export function parseEventJson(text: string): EventInterchangeResult {
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      issues: [{ code: "invalid_json", path: [], message: "The event file is not valid JSON" }]
    };
  }
  return migrateEvent(input);
}

export function migrateEvent(input: unknown): EventInterchangeResult {
  const dangerousIssues = findDangerousKeys(input);
  if (dangerousIssues.length > 0) return { ok: false, issues: dangerousIssues };

  if (!isRecord(input) || input.version !== 1) {
    return {
      ok: false,
      issues: [{
        code: "unsupported_version",
        path: ["version"],
        message: `Unsupported event schema version: ${isRecord(input) && "version" in input ? String(input.version) : "missing"}`
      }]
    };
  }

  const validated = validateEventState(input);
  if (!validated.success) return { ok: false, issues: validated.issues };
  return { ok: true, data: structuredClone(validated.data) };
}

function findDangerousKeys(value: unknown, path: Array<string | number> = [], seen = new WeakSet<object>()): ValidationIssue[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(value)) {
    const segment = Array.isArray(value) && /^\d+$/.test(key) ? Number(key) : key;
    const nextPath = [...path, segment];
    if (DANGEROUS_KEYS.has(key)) {
      issues.push({ code: "dangerous_key", path: nextPath, message: `Unsafe object key is not allowed: ${key}` });
    }
    issues.push(...findDangerousKeys((value as Record<string, unknown>)[key], nextPath, seen));
  }
  return issues;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObjectKeys(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
