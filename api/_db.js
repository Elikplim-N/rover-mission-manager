import pg from 'pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://rovadmin:S7ISb9PGLYnWzbB43fnu@178.105.184.157:3001/rover-hub';

let pool = global._pgPool;
if (!pool) {
  pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 4000,
    max: 5,
  });
  global._pgPool = pool;
}

export default pool;
