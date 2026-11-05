import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import * as schema from "./schema";
import { withExplicitSsl } from "./ssl";

// Keep NUMERIC as string (exact) — never let money become a JS float.
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
// int8 (bigserial ids, counts) → number. Safe for our id ranges.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

export type DB = NodePgDatabase<typeof schema>;
/** Either the root db or a transaction handle. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

declare global {
  var __omPool: Pool | undefined;
  var __omDb: DB | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({
    connectionString: withExplicitSsl(url),
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });
  // A server that drops an idle connection (Neon does when it pauses an idle database) makes the
  // pool emit "error". With no listener Node treats that as a crash, taking down whatever request
  // the instance is serving. The pool has already discarded the client; the next query opens a
  // new connection, so logging is all that is needed.
  pool.on("error", (err) => console.warn("[db] idle connection closed:", err.message));
  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__omPool) globalThis.__omPool = createPool();
  return globalThis.__omPool;
}

export function getDb(): DB {
  if (!globalThis.__omDb) globalThis.__omDb = drizzle(getPool(), { schema });
  return globalThis.__omDb;
}

/** Test hook: point the singleton at a different pool. */
export function __setDbForTests(pool: Pool) {
  globalThis.__omPool = pool;
  globalThis.__omDb = drizzle(pool, { schema });
}
