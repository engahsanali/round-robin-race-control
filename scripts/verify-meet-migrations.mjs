import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FILES = [
  "202608140001_meet_core.sql",
  "202608140002_meet_rls.sql",
  "202608140003_meet_commands.sql",
];

const OWNED_TABLES = [
  "organisations",
  "organisation_memberships",
  "organisation_invitations",
  "meets",
  "brackets",
  "participants",
  "cars",
  "heats",
  "advancement_rules",
  "advancement_rule_destinations",
  "advancement_snapshots",
  "advancement_selections",
  "audit_events",
  "security_events",
  "mutation_rate_limits",
];

const REQUIRED_RPCS = [
  "create_organisation",
  "create_invitation",
  "redeem_invitation",
  "remove_membership",
  "confirm_heat_winner",
  "correct_heat_winner",
  "confirm_advancement",
  "replace_advancement",
];

export async function verifyMeetMigrations(migrationsDirectory) {
  const issues = [];
  const sources = new Map();
  for (const fileName of REQUIRED_FILES) {
    try {
      sources.set(fileName, normalize(await readFile(path.join(migrationsDirectory, fileName), "utf8")));
    } catch {
      issues.push(issue("missing_migration", fileName, `Required migration is missing: ${fileName}`));
    }
  }
  if (sources.size !== REQUIRED_FILES.length) return { ok: false, issues };

  const core = sources.get(REQUIRED_FILES[0]);
  const rls = sources.get(REQUIRED_FILES[1]);
  const commands = sources.get(REQUIRED_FILES[2]);
  const all = `${core}\n${rls}\n${commands}`;

  for (const table of OWNED_TABLES) {
    if (!new RegExp(`create\\s+table\\s+public\\.${table}\\b`, "i").test(core)) {
      issues.push(issue("missing_table", table, `Missing required table public.${table}`));
    }
    if (!new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security\\s*;`, "i").test(rls)
        || !new RegExp(`alter\\s+table\\s+public\\.${table}\\s+force\\s+row\\s+level\\s+security\\s*;`, "i").test(rls)) {
      issues.push(issue("missing_rls", table, `public.${table} must enable and force RLS`));
    }
  }

  for (const policy of rls.matchAll(/create\s+policy\b[\s\S]*?;/gi)) {
    if (/\bto\s+[^;\n]*(?:anon|public)\b/i.test(policy[0])) {
      issues.push(issue("anonymous_policy", "RLS", "Meet policies must never target anon or public"));
    }
    if (/from\s+public\.organisation_memberships\b/i.test(policy[0])) {
      issues.push(issue("recursive_membership_policy", "RLS", "Policies must call fixed-path membership helpers"));
    }
  }

  const definerFunctions = [...all.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)\s*\([\s\S]*?\)\s*returns\b[\s\S]*?\$\$[\s\S]*?\$\$\s*;/gi)]
    .filter((match) => /security\s+definer/i.test(match[0]));
  for (const definition of definerFunctions) {
    if (!/set\s+search_path\s*=\s*''/i.test(definition[0])) {
      issues.push(issue("unsafe_definer", definition[1], `SECURITY DEFINER function ${definition[1]} lacks an empty search_path`));
    }
  }

  if (/grant\s+execute\s+on\s+all\s+functions[\s\S]*?\bto\s+(?:public|anon)\b/i.test(commands)
      || /grant\s+execute\s+on\s+function[\s\S]*?\bto\s+(?:public|anon)\b/i.test(commands)
      || !/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+public\s+from\s+public\s*,\s*anon\s*;/i.test(commands)) {
    issues.push(issue("unsafe_function_grant", "commands", "Public function execution is not safely revoked"));
  }

  for (const rpc of REQUIRED_RPCS) {
    if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\s*\\(`, "i").test(commands)
        || !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\s*\\(`, "i").test(commands)) {
      issues.push(issue("missing_rpc", rpc, `Required authenticated RPC is missing or ungranted: ${rpc}`));
    }
  }

  if (!/if\s+heat\.version\s*<>\s*expected_version\s+then/i.test(commands)
      || !/rule\.version\s*<>\s*expected_version/i.test(commands)
      || !/actual_source_version\s*<>\s*source_result_version/i.test(commands)) {
    issues.push(issue("missing_version_check", "RPCs", "Winner and advancement RPCs must check optimistic versions under lock"));
  }

  for (const action of [
    "organisation.created", "invitation.created", "invitation.redeemed", "membership.removed",
    "heat.winner_confirmed", "heat.winner_corrected", "advancement.confirmed", "advancement.replaced",
  ]) {
    if (!commands.includes(`'${action}'`)) {
      issues.push(issue("missing_audit_action", action, `Missing same-transaction audit action ${action}`));
    }
  }

  if ((core.match(/unique\s*\(snapshot_id\s*,\s*rule_id\s*,\s*source_car_id\s*\)/gi) ?? []).length < 2) {
    issues.push(issue("missing_lineage_constraint", "lineage", "Cars and selections need immutable snapshot/rule/source lineage uniqueness"));
  }

  const invitationTable = core.match(/create\s+table\s+public\.organisation_invitations\s*\([\s\S]*?\n\);/i)?.[0] ?? "";
  if (!/code_digest\s+text\s+not\s+null/i.test(invitationTable) || /\n\s*code\s+text\b/i.test(invitationTable)) {
    issues.push(issue("unsafe_invitation_storage", "organisation_invitations", "Invitation tables must store a digest, never the raw code"));
  }
  if (!/expires_at\s+timestamptz\s+not\s+null/i.test(invitationTable)
      || !/used_at\s+timestamptz/i.test(invitationTable)) {
    issues.push(issue("missing_invitation_expiry", "organisation_invitations", "Invitations must expire and be single-use"));
  }
  if (!/create\s+or\s+replace\s+function\s+private_meet\.consume_rate_limit\s*\(/i.test(commands)
      || (commands.match(/perform\s+private_meet\.consume_rate_limit\s*\(/gi) ?? []).length < 3) {
    issues.push(issue("missing_rate_limit", "sensitive RPCs", "Invitation and account mutations need first-party rate limiting"));
  }
  if (!/if\s+correction\s+and\s+not\s*\(char_length\(btrim\(reason\)\)\s+between\s+1\s+and\s+500\)\s+then/i.test(commands)
      || !/if\s+replacing\s+and\s+not\s*\(char_length\(btrim\(reason\)\)\s+between\s+1\s+and\s+500\)\s+then/i.test(commands)) {
    issues.push(issue("missing_reason_check", "corrections", "Corrections and replacements require bounded reasons"));
  }
  if (!/update\s+public\.advancement_snapshots\s+set\s+stale\s*=\s*true/i.test(commands)
      || !/with\s+recursive\s+stale_chain/i.test(commands)) {
    issues.push(issue("missing_stale_propagation", "winner RPCs", "Winner changes must propagate stale advancement transitively"));
  }
  if (!/unique\s*\(organisation_id\s*,\s*request_id\s*,\s*action\s*\)/i.test(core)
      || (commands.match(/event\.request_id\s*=/gi) ?? []).length < 4) {
    issues.push(issue("missing_idempotency_constraint", "audit_events", "Important RPC requests must be transactionally idempotent"));
  }
  if ((commands.match(/for\s+update/gi) ?? []).length < 5
      || !/jsonb_array_length\(selections\)\s*<>\s*rule\.top_n/i.test(commands)
      || !/destination_order[\s\S]*for\s+update/i.test(commands)) {
    issues.push(issue("missing_transaction_invariant", "RPCs", "RPCs must lock rows deterministically and validate exact advancement counts"));
  }
  for (const role of ["owner", "admin", "organiser", "marshal", "viewer"]) {
    if (!new RegExp(`'${role}'`).test(all)) issues.push(issue("missing_policy_role", role, `The schema and policies omit role ${role}`));
  }

  return { ok: issues.length === 0, issues };
}

function normalize(source) {
  return source.replaceAll("\r\n", "\n");
}

function issue(code, target, message) {
  return { code, target, message };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
  const result = await verifyMeetMigrations(directory);
  if (result.ok) {
    console.log(`Meet migration verification passed (${OWNED_TABLES.length} RLS tables, ${REQUIRED_RPCS.length} RPCs).`);
  } else {
    for (const finding of result.issues) console.error(`${finding.code}: ${finding.target}: ${finding.message}`);
    process.exitCode = 1;
  }
}
