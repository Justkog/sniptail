import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export interface IPgClient {
  kind: 'pg';
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
}

export async function createPgClient(databaseUrl: string): Promise<IPgClient> {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  return Promise.resolve({
    kind: 'pg',
    db,
    pool,
  });
}
