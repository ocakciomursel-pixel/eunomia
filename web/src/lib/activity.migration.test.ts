// The database refuses any `action` outside its CHECK allowlist, and logging is best-effort,
// so a verb the code emits but the migration forgot vanishes without a trace — which is
// exactly how every Leash-era row was lost between July and September 2026. This test
// reads the migration that owns the allowlist and asserts every verb the code can emit
// is in it. Adding an ActivityAction now fails here, not in production.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS } from "./activity";

const MIGRATION = resolve(__dirname, "../../../supabase/migrations/0005_activity_action_verbs.sql");
const CHECKS_0003 = resolve(__dirname, "../../../supabase/migrations/0003_data_quality_checks.sql");
const HYGIENE_0008 = resolve(__dirname, "../../../supabase/migrations/0008_migration_hygiene.sql");

function allowedVerbs(sql: string): string[] {
  const m = sql.match(/activity_action_allowed check \(action in \(([\s\S]*?)\)\)/i);
  if (!m) throw new Error("allowlist not found in migration");
  return Array.from(m[1].matchAll(/'([a-z_]+)'/g), (x) => x[1]);
}

describe("activity action allowlist", () => {
  const verbs = allowedVerbs(readFileSync(MIGRATION, "utf8"));

  it("covers every verb the code emits", () => {
    for (const a of ACTIVITY_ACTIONS) expect(verbs, `migration is missing '${a}'`).toContain(a);
  });

  it("has no verb the code never emits", () => {
    for (const v of verbs) expect(ACTIVITY_ACTIONS as readonly string[], `code never logs '${v}'`).toContain(v);
  });
});

describe("migration 0008 hygiene", () => {
  const sql0003 = readFileSync(CHECKS_0003, "utf8");
  const sql0008 = readFileSync(HYGIENE_0008, "utf8");

  it("drops the anon insert policy on feedback", () => {
    expect(sql0008).toMatch(/drop\s+policy\s+if\s+exists\s+"anon can insert feedback"\s+on\s+public\.feedback\s*;/i);
  });

  it("validates every NOT VALID constraint added in 0003_data_quality_checks.sql", () => {
    const constraints = Array.from(
      sql0003.matchAll(/alter\s+table\s+(public\.\w+)\s+add\s+constraint\s+(\w+)\s+check\s*\([\s\S]*?\)\s*not\s+valid\s*;/gi),
      (m) => ({ table: m[1], name: m[2] }),
    );
    expect(constraints.length).toBe(7);
    for (const { table, name } of constraints) {
      const re = new RegExp(`alter\\s+table\\s+${table.replace(".", "\\.")}\\s+validate\\s+constraint\\s+${name}\\s*;`, "i");
      expect(sql0008, `missing validate constraint for ${table}.${name}`).toMatch(re);
    }
  });
});
