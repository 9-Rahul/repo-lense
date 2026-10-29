import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Normalizes a PostgreSQL connection URL for node-postgres (`pg.Pool`):
 * 1. Encodes any unescaped `@` symbols inside the password segment.
 * 2. Strips Prisma-only query parameters like `?pgbouncer=true` that node-postgres doesn't use.
 */
function normalizePgConnectionString(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  let cleaned = rawUrl.trim();

  // If the authority part has multiple '@' signs (e.g. password contains raw '@'), encode all but the last '@'
  const protoMatch = cleaned.match(/^(postgresql?:\/\/)(.*)$/i);
  if (protoMatch) {
    const [, scheme, rest] = protoMatch;
    const slashIdx = rest.indexOf('/');
    const authority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const pathAndQuery = slashIdx === -1 ? '' : rest.slice(slashIdx);

    const lastAtIdx = authority.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const userInfo = authority.slice(0, lastAtIdx);
      const hostPort = authority.slice(lastAtIdx + 1);
      const colonIdx = userInfo.indexOf(':');
      if (colonIdx !== -1) {
        const user = userInfo.slice(0, colonIdx);
        const pass = userInfo.slice(colonIdx + 1).replace(/@/g, '%40');
        cleaned = `${scheme}${user}:${pass}@${hostPort}${pathAndQuery}`;
      }
    }
  }

  // Strip ?pgbouncer=true which is only for Prisma's legacy Rust engine, not node-postgres
  cleaned = cleaned
    .replace(/([?&])pgbouncer=true(&?)/i, (_, prefix, suffix) => (suffix ? prefix : ''))
    .replace(/\?$/, '');

  return cleaned;
}

const globalForPrisma = globalThis as unknown as {
  pool: Pool | undefined;
  prisma: PrismaClient | undefined;
  vectorIndexesEnsured: boolean | undefined;
};

// Prefer DIRECT_URL (Supabase Session Pooler :5432) for node-postgres Pool so
// prepared statements and DDL (CREATE INDEX) work reliably without transaction pooler errors
const connectionString = normalizePgConnectionString(
  process.env.DIRECT_URL || process.env.DATABASE_URL
);

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(pool) });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pool = pool;
  globalForPrisma.prisma = prisma;
}

/**
 * Ensures the foreign-key B-tree index on Chunk(fileId) and the pgvector HNSW
 * cosine index on Chunk(embedding) exist in PostgreSQL.
 */
export async function ensureVectorIndexes(): Promise<void> {
  if (globalForPrisma.vectorIndexesEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Chunk_fileId_idx"
      ON "Chunk" ("fileId");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Chunk_embedding_hnsw_idx"
      ON "Chunk" USING hnsw (embedding vector_cosine_ops);
    `);
    globalForPrisma.vectorIndexesEnsured = true;
  } catch (err) {
    console.warn('[Database] Could not auto-create vector/FK indexes:', err);
  }
}
