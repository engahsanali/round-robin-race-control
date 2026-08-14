import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FILES = [
  "202608140001_meet_core.sql",
  "202608140002_meet_rls.sql",
  "202608140003_meet_commands.sql",
  "202608140004_meet_review_hardening.sql",
  "202608140005_meet_ranking_and_access_hardening.sql",
  "202608140006_meet_preliminary_and_identity_hardening.sql",
  "202608140007_meet_workbook_commands.sql",
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
  "record_security_event",
  "revoke_invitation",
  "list_organisation_members",
  "save_meet_workbook",
  "save_registration_batch",
  "activate_bracket_schedule",
];

export function verifyWorkbookCommandInvariant(source) {
  const sql = normalize(source);
  const latest = lastMigrationV7(sql);
  const issues = [];
  const requireMarker = (condition, code, target, message) => {
    if (!condition) issues.push(issue(code, target, message));
  };
  requireMarker(
    /function\s+public\.save_meet_workbook\s*\(\s*target_organisation_id\s+uuid\s*,\s*target_meet_id\s+uuid\s*,\s*expected_version\s+integer\s*,\s*workbook\s+jsonb\s*,\s*request_id\s+uuid/i.test(latest)
      && /jsonb_array_length\(workbook->'brackets'\)\s+not\s+between\s+1\s+and\s+15/i.test(latest)
      && /MEET_ADVANCEMENT_CYCLE/i.test(latest)
      && /MEET_DESTINATION_CAPACITY/i.test(latest)
      && /meet\.workbook_saved/i.test(latest),
    "missing_workbook_transaction", "save_meet_workbook",
    "Workbook setup must be a versioned, audited transaction with bracket, DAG and capacity validation",
  );
  requireMarker(
    /function\s+public\.save_registration_batch\s*\(\s*target_bracket_id\s+uuid\s*,\s*expected_version\s+integer\s*,\s*rows\s+jsonb\s*,\s*request_id\s+uuid/i.test(latest)
      && /MEET_DUPLICATE_CAR_NUMBER/i.test(latest)
      && /MEET_REGISTRATION_LINEAGE_LOCKED/i.test(latest)
      && /registration\.batch_saved/i.test(latest),
    "missing_registration_transaction", "save_registration_batch",
    "Registration batches must atomically upsert bracket-scoped identities and active state without mutating advancement lineage",
  );
  requireMarker(
    /function\s+public\.activate_bracket_schedule\s*\(\s*target_bracket_id\s+uuid\s*,\s*expected_version\s+integer\s*,\s*schedule\s+jsonb\s*,\s*replacement_reason\s+text\s*,\s*request_id\s+uuid/i.test(latest)
      && /MEET_CONFIRMED_RESULTS_EXIST/i.test(latest)
      && /MEET_DUPLICATE_ROUND_APPEARANCE/i.test(latest)
      && /opponentRepeatExcess/i.test(latest)
      && /schedule\.activated/i.test(latest),
    "missing_schedule_transaction", "activate_bracket_schedule",
    "Schedule activation must validate active lanes, rounds and quality before pending-only replacement",
  );
  requireMarker(
    /function\s+private_meet\.lane_times_from_milliseconds/i.test(latest)
      && /numeric\(12\s*,\s*3\)/i.test(latest)
      && /1000::numeric/i.test(latest)
      && /MEET_INVALID_LANE_TIMES/i.test(latest),
    "missing_exact_millisecond_conversion", "lane times",
    "Integer browser milliseconds must convert exactly to numeric seconds with three decimal places",
  );
  requireMarker(
    /revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.meets[\s\S]*?public\.advancement_rule_destinations\s+from\s+authenticated/i.test(latest)
      && /revoke\s+insert\s*\(organisation_id\s*,\s*bracket_id\s*,\s*round_number[\s\S]*?\)\s+on\s+public\.heats\s+from\s+authenticated/i.test(latest)
      && /revoke\s+update\s*\(round_number\s*,\s*heat_number[\s\S]*?\)\s+on\s+public\.heats\s+from\s+authenticated/i.test(latest),
    "workbook_rpc_bypass", "direct table grants",
    "Workbook setup, registration, schedule and progression writes must not bypass their validated RPC transactions",
  );
  requireMarker(
    /has_snapshots\s+and[\s\S]*MEET_WORKBOOK_IN_USE/i.test(latest)
      && /version\s*=\s*case\s+when\s+has_snapshots\s+then\s+public\.brackets\.version/i.test(latest)
      && /version\s*=\s*case\s+when\s+has_snapshots\s+then\s+public\.advancement_rules\.version/i.test(latest),
    "mutable_confirmed_progression", "save_meet_workbook",
    "After advancement, harmless meet metadata may change but the bracket/rule graph and source-result versions must stay frozen",
  );
  requireMarker(
    /MEET_SCHEDULE_QUALITY_MISMATCH/i.test(latest)
      && /MEET_UNBALANCED_APPEARANCES/i.test(latest)
      && /MEET_UNBALANCED_LANES/i.test(latest)
      && /computed_repeat_excess/i.test(latest)
      && /computed_lane_spread/i.test(latest),
    "unverified_schedule_quality", "activate_bracket_schedule",
    "Schedule quality must be recomputed server-side and balanced before client-reported metrics are trusted",
  );
  requireMarker(
    /MEET_REGISTRATION_SCHEDULED/i.test(latest)
      && /participant\.id\s*=\s*\(row_value->>'participantId'\)::uuid[\s\S]*MEET_REGISTRATION_LINEAGE_LOCKED/i.test(latest)
      && /MEET_INCONSISTENT_DESTINATION_CAPACITY/i.test(latest)
      && /stale_advancement_count/i.test(latest),
    "workbook_relational_bypass", "registration and capacity",
    "Registration must preserve scheduled and advanced identities, and shared destinations need one capacity contract",
  );
  requireMarker(
    /meet\.bracket_saved\./i.test(latest)
      && /meet\.rule_saved\./i.test(latest)
      && /registration\.row_saved\./i.test(latest)
      && /schedule\.heat_retired\./i.test(latest)
      && /schedule\.heat_activated\./i.test(latest),
    "missing_entity_audit_deltas", "workbook commands",
    "Destructive and overwriting workbook commands must retain bounded per-entity before and after values",
  );
  const snapshotLoad = latest.search(/select\s+exists\s*\([\s\S]*?public\.advancement_snapshots[\s\S]*?into\s+has_snapshots/i);
  const capacitySimulation = latest.search(/if\s+not\s+has_snapshots\s+and\s+exists\s*\(\s*with\s+recursive\s+bracket_payload/i);
  requireMarker(
    /drop\s+constraint\s+audit_events_organisation_id_bracket_id_fkey/i.test(latest)
      && /add\s+constraint\s+audit_events_bracket_id_fkey[\s\S]*?on\s+delete\s+set\s+null\s*\(\s*bracket_id\s*\)/i.test(latest)
      && snapshotLoad >= 0 && capacitySimulation > snapshotLoad,
    "workbook_lifecycle_break", "post-advancement lifecycle",
    "Metadata saves after advancement must not double-allocate capacity, and deleted brackets must retain organisation-owned audit history",
  );
  for (const rpc of ["save_meet_workbook", "save_registration_batch", "activate_bracket_schedule"]) {
    requireMarker(
      new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${rpc}[\\s\\S]*?from\\s+public\\s*,\\s*anon`, "i").test(latest)
        && new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}[\\s\\S]*?to\\s+authenticated`, "i").test(latest),
      "unsafe_workbook_rpc_grant", rpc,
      `Workbook RPC ${rpc} must be executable only by authenticated users`,
    );
  }
  return issues;
}

export function verifyReviewRound2Invariant(source) {
  const sql = normalize(source);
  const issues = [];
  const requireMarker = (condition, code, target, message) => {
    if (!condition) issues.push(issue(code, target, message));
  };
  requireMarker(
    /function\s+private_meet\.advancement_ranking/i.test(sql)
      && /ranking_mode[\s\S]*(?:competition|dense)[\s\S]*ordinal/i.test(sql)
      && /totalwins[\s\S]*headtohead[\s\S]*matcheswon[\s\S]*averagetime[\s\S]*besttime[\s\S]*lanebalance[\s\S]*carnumber[\s\S]*playoff/i.test(sql)
      && /MEET_ORDINAL_TIE_UNRESOLVED/i.test(sql),
    "ranking_policy_mismatch", "advancement ranking",
    "Database advancement ranks must reproduce stored Meet domain ranking mode and configured tie-break order",
  );
  requireMarker(
    /order\s+by\s+ranking\.competitive_rank\s*,\s*ranking\.source_car_id/i.test(sql)
      && !/order\s+by\s+ranking\.competitive_rank\s*,\s*(?:source_car\.)?car_number/i.test(lastMigrationV5(sql)),
    "unstable_equal_rank_allocation", "advancement allocation",
    "Equal-rank candidates must allocate in locale-independent stable source-ID order",
  );
  requireMarker(
    /revoke\s+insert\s+on\s+public\.cars\s+from\s+authenticated/i.test(sql)
      && /grant\s+insert\s*\(organisation_id\s*,\s*bracket_id\s*,\s*participant_id\s*,\s*car_number\s*,\s*name\)\s+on\s+public\.cars\s+to\s+authenticated/i.test(sql),
    "unsafe_car_lineage_insert", "cars",
    "Direct registration INSERT must not grant advancement lineage columns",
  );
  requireMarker(
    /invitation_role\s*=\s*'owner'[\s\S]*array\s*\[\s*'owner'\s*\]/i.test(sql),
    "owner_invitation_escalation", "create_invitation",
    "Only an owner may create an owner-role invitation",
  );
  requireMarker(
    /function\s+public\.revoke_invitation/i.test(sql)
      && /invitation\.revoked/i.test(sql)
      && /grant\s+execute\s+on\s+function\s+public\.revoke_invitation/i.test(sql),
    "missing_revoke_invitation_rpc", "organisation_invitations",
    "Invitation revocation must be role-scoped, audited, idempotent and RPC-only",
  );
  requireMarker(
    /function\s+public\.list_organisation_members/i.test(sql)
      && /case\s+when\s+private_meet\.has_org_role[\s\S]*then\s+identity\.email\s+else\s+null/i.test(sql)
      && !/grant\s+select\s+on\s+(?:table\s+)?auth\.users\s+to\s+authenticated/i.test(sql),
    "unsafe_member_identity_access", "member identity",
    "Member identity must use a same-organisation least-privilege RPC without broad auth.users access",
  );
  requireMarker(
    /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.organisations/i.test(sql)
      && /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.organisation_memberships/i.test(sql)
      && /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.organisation_invitations/i.test(sql),
    "missing_access_realtime", "supabase_realtime",
    "Organisation, membership and invitation changes must use authorised RLS-backed Realtime",
  );
  return issues;
}

export function verifyReviewRound3Invariant(source) {
  const sql = normalize(source);
  const latest = lastMigrationV6(sql);
  const issues = [];
  const requireMarker = (condition, code, target, message) => {
    if (!condition) issues.push(issue(code, target, message));
  };
  requireMarker(
    /function\s+private_meet\.advancement_ranking/i.test(latest)
      && (latest.match(/heat\.phase\s*=\s*'preliminary'/gi) ?? []).length >= 8
      && /function\s+private_meet\.preliminary_source_is_complete/i.test(latest)
      && /MEET_V6_ADVANCEMENT_PATCH_NOT_APPLIED/i.test(latest),
    "non_preliminary_advancement_results", "advancement results",
    "Ranking metrics and source completeness must use only preliminary-phase heats",
  );
  requireMarker(
    /'Member\s+'\s*\|\|\s*left\(replace\(membership\.user_id::text\s*,\s*'-'\s*,\s*''\)\s*,\s*8\)/i.test(latest)
      && /identity\.raw_user_meta_data->>'display_name'/i.test(latest)
      && !/split_part\(identity\.email/i.test(latest),
    "member_label_email_leak", "member directory",
    "Non-admin display labels must use bounded explicit metadata or a neutral stable-ID label, never email text",
  );
  return issues;
}

export function verifyReviewInvariant(source) {
  const sql = normalize(source);
  const issues = [];
  const requireMarker = (condition, code, target, message) => {
    if (!condition) issues.push(issue(code, target, message));
  };

  requireMarker(
    /invitation_failure_result[\s\S]*MEET_INVITATION_UNAVAILABLE/i.test(sql)
      && /rate_limit_result[\s\S]*MEET_RATE_LIMITED/i.test(sql),
    "aborting_invitation_failure", "redeem_invitation",
    "Invalid, expired and rate-limited invitation attempts must return structured results so counters commit",
  );
  requireMarker(
    /grant\s+insert\s*\(organisation_id\s*,\s*bracket_id\s*,\s*round_number\s*,\s*heat_number\s*,\s*phase\s*,\s*lane_1_car_id\s*,\s*lane_2_car_id\s*,\s*lane_3_car_id\)\s+on\s+public\.heats/i.test(sql)
      && /revoke\s+insert\s+on\s+public\.heats\s+from\s+authenticated/i.test(sql),
    "unsafe_heat_insert_grant", "heats",
    "Authenticated direct heat INSERT must be restricted to safe schedule columns",
  );
  requireMarker(
    (sql.match(/reason\s+is\s+null\s+or\s+char_length\(btrim\(reason\)\)\s+not\s+between\s+1\s+and\s+500/gi) ?? []).length >= 4,
    "nullable_reason_bypass", "reason validation",
    "Every required reason must reject NULL, blank and overlong input",
  );
  requireMarker(
    /create\s+unique\s+index\s+cars_one_active_source_lineage[\s\S]*\(source_bracket_id\s*,\s*source_car_id\)[\s\S]*where[\s\S]*source_car_id\s+is\s+not\s+null[\s\S]*and\s+active/i.test(sql),
    "missing_global_active_lineage", "cars lineage",
    "Only one active advancement is allowed per source bracket and source car across rules and snapshots",
  );
  requireMarker(
    /update\s+public\.cars\s+set\s+active\s*=\s*false\s+where\s+snapshot_id\s*=\s*previous\.id/i.test(sql)
      && !/delete\s+from\s+public\.cars\s+where\s+snapshot_id\s*=\s*previous\.id/i.test(lastMigration(sql)),
    "destructive_advancement_replacement", "replace_advancement",
    "Replacement must retire historical cars without deleting downstream lineage",
  );
  requireMarker(
    /alter\s+table\s+public\.advancement_rule_destinations\s+add\s+column\s+meet_id/i.test(sql)
      && /advancement_rule_destinations_same_meet_fk/i.test(sql)
      && /advancement_rules_source_same_meet_fk/i.test(sql),
    "missing_same_meet_graph", "advancement graph",
    "Rules, sources and destinations require composite same-organisation, same-meet constraints",
  );
  requireMarker(
    /expected_destination_id/i.test(sql)
      && /MEET_DESTINATION_ALLOCATION/i.test(sql)
      && /destination_order[\s\S]*active_occupancy/i.test(sql),
    "missing_server_allocation", "advancement allocation",
    "The server must derive balanced destination allocation from active occupancy and stable order",
  );
  requireMarker(
    /source_is_complete/i.test(sql)
      && /MEET_SOURCE_INCOMPLETE/i.test(sql)
      && /cutoff_end\s*>\s*rule\.top_n/i.test(sql)
      && !/rank\(\)\s+over\s*\(order\s+by\s+wins\s+desc\s*,\s*(?:car\.)?id/i.test(lastMigration(sql)),
    "unsafe_cutoff_ranking", "advancement ranking",
    "Automatic advancement must use server result groups, never UUID order, and reject incomplete sources",
  );
  requireMarker(
    /create\s+or\s+replace\s+function\s+private_meet\.audit_direct_meet_mutation/i.test(sql)
      && /car\.inserted/i.test(sql)
      && /heat\.schedule_inserted/i.test(sql)
      && /advancement_rule\.updated/i.test(sql),
    "unaudited_direct_mutation", "direct mutations",
    "Direct organiser mutations must bump versions and write actor/before/after audit in the same transaction",
  );
  requireMarker(
    /lock\s+table\s+public\.organisations\s+in\s+row\s+exclusive\s+mode/i.test(sql)
      && /order\s+by\s+membership\.user_id\s+for\s+update/i.test(sql),
    "unserialized_last_owner", "remove_membership",
    "Membership removal must serialize the organisation owner set before checking the final owner",
  );
  requireMarker(
    /alter\s+publication\s+supabase_realtime\s+add\s+table\s+public\.heats/i.test(sql)
      && /public\.security_events/i.test(sql),
    "missing_realtime_publication", "supabase_realtime",
    "RLS-readable operational tables must be explicitly published to authorised Realtime clients",
  );
  requireMarker(
    /create\s+or\s+replace\s+function\s+public\.record_security_event/i.test(sql)
      && /MEET_SECURITY_EVENT_NOT_ALLOWED/i.test(sql)
      && /grant\s+execute\s+on\s+function\s+public\.record_security_event/i.test(sql),
    "missing_security_event_rpc", "security_events",
    "Authenticated members need a rate-limited, allow-listed, idempotent security-event RPC",
  );
  requireMarker(
    /lane_2_car_id\s+is\s+not\s+null\s+or\s+lane_2_time\s+is\s+null/i.test(sql)
      && /lane_3_car_id\s+is\s+not\s+null\s+or\s+lane_3_time\s+is\s+null/i.test(sql)
      && /MEET_INVALID_LANE_TIMES/i.test(sql),
    "unassigned_lane_time", "lane times",
    "Unassigned lanes must have absent or null times at both table and RPC boundaries",
  );
  return issues;
}

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
  const allMigrations = [...sources.values()].join("\n");

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

  const definerFunctions = [...allMigrations.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)\s*\([\s\S]*?\)\s*returns\b[\s\S]*?\$\$[\s\S]*?\$\$\s*;/gi)]
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
    if (!new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\s*\\(`, "i").test(allMigrations)
        || !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\s*\\(`, "i").test(allMigrations)) {
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

  issues.push(...verifyReviewInvariant(allMigrations));
  issues.push(...verifyReviewRound2Invariant(allMigrations));
  issues.push(...verifyReviewRound3Invariant(allMigrations));
  issues.push(...verifyWorkbookCommandInvariant(allMigrations));
  return { ok: issues.length === 0, issues, schemaVersion: REQUIRED_FILES.length };
}

function normalize(source) {
  return source.replaceAll("\r\n", "\n");
}

function issue(code, target, message) {
  return { code, target, message };
}

function lastMigration(source) {
  const marker = "-- REVIEW HARDENING V4";
  const index = source.lastIndexOf(marker);
  return index === -1 ? source : source.slice(index);
}

function lastMigrationV5(source) {
  const marker = "-- REVIEW HARDENING V5";
  const index = source.lastIndexOf(marker);
  return index === -1 ? source : source.slice(index);
}

function lastMigrationV6(source) {
  const marker = "-- REVIEW HARDENING V6";
  const index = source.lastIndexOf(marker);
  return index === -1 ? source : source.slice(index);
}

function lastMigrationV7(source) {
  const marker = "-- WORKBOOK COMMANDS V7";
  const index = source.lastIndexOf(marker);
  return index === -1 ? source : source.slice(index);
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
