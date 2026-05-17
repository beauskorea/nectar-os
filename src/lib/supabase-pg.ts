import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    host: process.env.SUPABASE_HOST,
    port: parseInt(process.env.SUPABASE_PORT || "5432", 10),
    user: (process.env.SUPABASE_USER || "postgres").trim(),
    password: process.env.SUPABASE_PASSWORD,
    database: process.env.SUPABASE_DB || "postgres",
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return pool;
}
