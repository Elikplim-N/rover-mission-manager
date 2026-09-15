import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://rovadmin:S7ISb9PGLYnWzbB43fnu@178.105.184.157:6000/rover-hub';

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
});

let isPostgresAvailable = false;
const inMemoryMissions = new Map();

export function getPostgresStatus() {
  return isPostgresAvailable;
}

export async function initDB() {
  try {
    const client = await pool.connect();
    console.log('[DB] Successfully connected to PostgreSQL at', connectionString.split('@')[1] || connectionString);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS missions (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        config_id VARCHAR(64),
        field_id VARCHAR(64),
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        tags JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telemetry_points (
        id BIGSERIAL PRIMARY KEY,
        mission_id VARCHAR(64) REFERENCES missions(id) ON DELETE CASCADE,
        row_num INT NOT NULL,
        drop_num INT NOT NULL,
        syn_x FLOAT NOT NULL,
        syn_y FLOAT NOT NULL,
        volt FLOAT,
        temp_c FLOAT,
        hum FLOAT,
        press FLOAT,
        elev FLOAT,
        moist INT,
        watered BOOLEAN DEFAULT false,
        abs_head FLOAT,
        err FLOAT,
        pitch FLOAT,
        roll FLOAT,
        lat FLOAT,
        lng FLOAT,
        sats INT DEFAULT 0,
        obs_dist FLOAT,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_mission ON telemetry_points(mission_id);
      CREATE INDEX IF NOT EXISTS idx_telemetry_row_drop ON telemetry_points(mission_id, row_num, drop_num);
    `);
    client.release();
    isPostgresAvailable = true;
    console.log('[DB] Schema initialized successfully');
  } catch (err) {
    console.warn('[DB] PostgreSQL connection failed. Falling back to in-memory persistence mode.');
    console.warn('[DB] Error:', err.message);
    isPostgresAvailable = false;
  }
}

export async function saveMission(mission) {
  if (!isPostgresAvailable) {
    inMemoryMissions.set(mission.id, mission);
    return mission;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO missions (id, name, config_id, field_id, start_time, end_time, tags, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        config_id = EXCLUDED.config_id,
        field_id = EXCLUDED.field_id,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        tags = EXCLUDED.tags,
        updated_at = NOW()
    `, [
      mission.id,
      mission.name,
      mission.configId || null,
      mission.fieldId || null,
      mission.startTime ? new Date(mission.startTime) : new Date(),
      mission.endTime ? new Date(mission.endTime) : null,
      JSON.stringify(mission.tags || [])
    ]);

    if (mission.telemetry && mission.telemetry.length > 0) {
      await client.query('DELETE FROM telemetry_points WHERE mission_id = $1', [mission.id]);
      
      for (const t of mission.telemetry) {
        await client.query(`
          INSERT INTO telemetry_points (
            mission_id, row_num, drop_num, syn_x, syn_y, volt, temp_c, hum, press, elev,
            moist, watered, abs_head, err, pitch, roll, lat, lng, sats, obs_dist
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        `, [
          mission.id,
          t.row ?? 0,
          t.drop ?? 0,
          t.synX ?? 0,
          t.synY ?? 0,
          t.volt ?? null,
          t.tempC ?? null,
          t.hum ?? null,
          t.press ?? null,
          t.elev ?? 0,
          t.moist ?? 0,
          t.watered ?? false,
          t.absHead ?? 0,
          t.err ?? 0,
          t.pitch ?? 0,
          t.roll ?? 0,
          t.lat ?? 0,
          t.lng ?? 0,
          t.sats ?? 0,
          t.obsDist ?? null
        ]);
      }
    }

    await client.query('COMMIT');
    return mission;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function appendTelemetryPoint(point) {
  const missionId = point.missionId || 'live-active-mission';

  if (!isPostgresAvailable) {
    let m = inMemoryMissions.get(missionId);
    if (!m) {
      m = {
        id: missionId,
        name: `Live Rover Run ${new Date().toLocaleDateString()}`,
        startTime: new Date().toISOString(),
        tags: ['live-telemetry'],
        telemetry: []
      };
      inMemoryMissions.set(missionId, m);
    }
    m.telemetry.push(point);
    return point;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO missions (id, name, start_time)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [missionId, `Live Rover Run ${new Date().toLocaleDateString()}`]);

    await client.query(`
      INSERT INTO telemetry_points (
        mission_id, row_num, drop_num, syn_x, syn_y, volt, temp_c, hum, press, elev,
        moist, watered, abs_head, err, pitch, roll, lat, lng, sats, obs_dist
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `, [
      missionId,
      point.row ?? 0,
      point.drop ?? 0,
      point.synX ?? 0,
      point.synY ?? 0,
      point.volt ?? null,
      point.tempC ?? null,
      point.hum ?? null,
      point.press ?? null,
      point.elev ?? 0,
      point.moist ?? 0,
      point.watered ?? false,
      point.absHead ?? 0,
      point.err ?? 0,
      point.pitch ?? 0,
      point.roll ?? 0,
      point.lat ?? 0,
      point.lng ?? 0,
      point.sats ?? 0,
      point.obsDist ?? null
    ]);
    return point;
  } finally {
    client.release();
  }
}

export async function getAllMissions() {
  if (!isPostgresAvailable) {
    return Array.from(inMemoryMissions.values());
  }

  const { rows: missionRows } = await pool.query(`
    SELECT m.*, COUNT(t.id) as point_count
    FROM missions m
    LEFT JOIN telemetry_points t ON m.id = t.mission_id
    GROUP BY m.id
    ORDER BY m.start_time DESC
  `);

  const results = [];
  for (const row of missionRows) {
    const { rows: telemetryRows } = await pool.query(`
      SELECT row_num as row, drop_num as drop, syn_x as "synX", syn_y as "synY",
             volt, temp_c as "tempC", hum, press, elev, moist, watered,
             abs_head as "absHead", err, pitch, roll, lat, lng, sats, obs_dist as "obsDist"
      FROM telemetry_points
      WHERE mission_id = $1
      ORDER BY id ASC
    `, [row.id]);

    results.push({
      id: row.id,
      name: row.name,
      configId: row.config_id || '',
      fieldId: row.field_id || '',
      startTime: row.start_time,
      endTime: row.end_time,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
      telemetry: telemetryRows
    });
  }

  return results;
}

export async function getMissionById(id) {
  if (!isPostgresAvailable) {
    return inMemoryMissions.get(id) || null;
  }

  const { rows } = await pool.query('SELECT * FROM missions WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const row = rows[0];

  const { rows: telemetryRows } = await pool.query(`
    SELECT row_num as row, drop_num as drop, syn_x as "synX", syn_y as "synY",
           volt, temp_c as "tempC", hum, press, elev, moist, watered,
           abs_head as "absHead", err, pitch, roll, lat, lng, sats, obs_dist as "obsDist"
    FROM telemetry_points
    WHERE mission_id = $1
    ORDER BY id ASC
  `, [id]);

  return {
    id: row.id,
    name: row.name,
    configId: row.config_id || '',
    fieldId: row.field_id || '',
    startTime: row.start_time,
    endTime: row.end_time,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
    telemetry: telemetryRows
  };
}
