// Creates the pettycash schema and a login role that can reach ONLY that schema, then proves the isolation.
// Run with ADMIN_DB_URL set to a Postgres admin connection string. Secrets are never printed.
//
//   ADMIN_DB_URL=... pnpm tsx scripts/db-setup.ts
//
// Writes DATABASE_URL (the restricted role, transaction pooler) to .env.local unless it is already there.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const ROLE = "pettycash_app";
const adminUrl = process.env.ADMIN_DB_URL;
if (!adminUrl) throw new Error("ADMIN_DB_URL is required");
const envPath = join(process.cwd(), ".env.local");
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

async function main() {
  const admin = postgres(adminUrl!, { max: 1, prepare: false, onnotice: () => {} });
  const schemaSql = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  await admin.unsafe(schemaSql);

  const existing = /^DATABASE_URL=(.+)$/m.exec(envText)?.[1];
  let password = existing ? decodeURIComponent(new URL(existing).password) : randomBytes(24).toString("hex");
  const [{ exists }] = await admin`select exists(select 1 from pg_roles where rolname = ${ROLE}) as exists`;
  if (!exists) await admin.unsafe(`create role ${ROLE} login password '${password}' noinherit`);
  else if (!existing) { password = randomBytes(24).toString("hex"); await admin.unsafe(`alter role ${ROLE} with login password '${password}'`); }

  await admin.unsafe(`
    grant usage on schema pettycash to ${ROLE};
    grant select, insert, update, delete on all tables in schema pettycash to ${ROLE};
    grant usage, select on all sequences in schema pettycash to ${ROLE};
    alter default privileges in schema pettycash grant select, insert, update, delete on tables to ${ROLE};
    alter default privileges in schema pettycash grant usage, select on sequences to ${ROLE};
    alter role ${ROLE} set search_path = pettycash;
  `);
  await admin.end();

  // Build the restricted URL: same pooler host, transaction mode (port 6543), username role.projectref.
  const u = new URL(adminUrl!);
  const ref = u.username.includes(".") ? u.username.split(".").slice(1).join(".") : "";
  const restricted = new URL(adminUrl!);
  restricted.username = ref ? `${ROLE}.${ref}` : ROLE;
  restricted.password = password;
  restricted.port = "6543";

  // Prove it: can write and read its own table; cannot read anything in public.
  const app = postgres(restricted.toString(), { max: 1, prepare: false, onnotice: () => {} });
  await app`insert into pettycash.settings (key, value) values ('db_setup_check', ${app.json({ at: new Date().toISOString() })}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
  const [row] = await app`select key from pettycash.settings where key = 'db_setup_check'`;
  const publicTables = await app`select table_name from information_schema.tables where table_schema = 'public'`;
  let blocked = 0, readable = 0;
  for (const t of publicTables) {
    try { await app.unsafe(`select 1 from public."${t.table_name}" limit 1`); readable++; } catch { blocked++; }
  }
  const visibleElsewhere = await app`select count(*)::int as n from information_schema.role_table_grants where grantee = ${ROLE} and table_schema <> 'pettycash'`;
  await app.end();
  console.log(JSON.stringify({ ownSchemaWorks: row?.key === "db_setup_check", publicTablesVisibleToRole: publicTables.length, publicReadable: readable, publicBlocked: blocked, grantsOutsideSchema: visibleElsewhere[0].n }));

  if (!existing) {
    writeFileSync(envPath, `${envText}${envText && !envText.endsWith("\n") ? "\n" : ""}DATABASE_URL=${restricted.toString()}\n`, { mode: 0o600 });
    console.log("DATABASE_URL written to .env.local");
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
