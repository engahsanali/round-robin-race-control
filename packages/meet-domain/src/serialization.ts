import { inspectMeetJsonSafety, validateMeetState } from "./schema";
import type { MeetInterchangeResult, MeetStateV1 } from "./types";

export function serializeMeet(state: MeetStateV1): string {
  const result = validateMeetState(state);
  if (!result.success) throw new Error(`Cannot serialize invalid meet state: ${result.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return `${JSON.stringify(sortObjectKeys(result.data), null, 2)}\n`;
}

export function parseMeetJson(text: string): MeetInterchangeResult {
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { return { ok: false, issues: [{ code: "invalid_json", path: [], message: "The meet file is not valid JSON" }] }; }
  const safety = inspectMeetJsonSafety(input);
  if (safety.length > 0) return { ok: false, issues: safety };
  const result = validateMeetState(input);
  return result.success ? { ok: true, data: structuredClone(result.data) } : { ok: false, issues: result.issues };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortObjectKeys(record[key])]));
}
