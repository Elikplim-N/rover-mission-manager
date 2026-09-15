import pool from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. GET: Fetch missions with optional telemetry points
  if (req.method === 'GET') {
    try {
      const missionsRes = await pool.query(
        'SELECT id, name, config_id as "configId", field_id as "fieldId", start_time as "startTime", end_time as "endTime", tags FROM missions ORDER BY start_time DESC LIMIT 50'
      );

      const missions = missionsRes.rows;

      // Attach telemetry points for each mission
      for (const m of missions) {
        const teleRes = await pool.query(
          `SELECT row_num as row, drop_num as drop, syn_x as "synX", syn_y as "synY", volt, temp_c as "tempC", hum, press, elev, moist, watered, abs_head as "absHead", err, pitch, roll, lat, lng, sats, obs_dist as "obsDist"
           FROM telemetry_points
           WHERE mission_id = $1
           ORDER BY id ASC LIMIT 2000`,
          [m.id]
        );
        m.telemetry = teleRes.rows;
      }

      return res.status(200).json(missions);
    } catch (err) {
      console.error('Failed to get missions from DB:', err);
      return res.status(200).json([]);
    }
  }

  // 2. POST: Save mission and telemetry
  if (req.method === 'POST') {
    const mission = req.body;
    if (!mission || !mission.id) {
      return res.status(400).json({ ok: false, error: 'Invalid mission payload. Missing id.' });
    }

    try {
      await pool.query('BEGIN');
      await pool.query(
        `INSERT INTO missions (id, name, config_id, field_id, start_time, end_time, tags, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           config_id = EXCLUDED.config_id,
           field_id = EXCLUDED.field_id,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           tags = EXCLUDED.tags,
           updated_at = NOW()`,
        [
          mission.id,
          mission.name || 'Field Mission',
          mission.configId || null,
          mission.fieldId || null,
          mission.startTime ? new Date(mission.startTime) : new Date(),
          mission.endTime ? new Date(mission.endTime) : null,
          JSON.stringify(mission.tags || [])
        ]
      );

      if (Array.isArray(mission.telemetry) && mission.telemetry.length > 0) {
        for (const pt of mission.telemetry) {
          await pool.query(
            `INSERT INTO telemetry_points (
              mission_id, row_num, drop_num, syn_x, syn_y, volt, temp_c, hum, press, elev, moist, watered, abs_head, err, pitch, roll, lat, lng, sats, obs_dist
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
            [
              mission.id,
              pt.row || 1,
              pt.drop || 1,
              pt.synX || 0,
              pt.synY || 0,
              pt.volt || null,
              pt.tempC || null,
              pt.hum || null,
              pt.press || null,
              pt.elev || null,
              pt.moist || null,
              pt.watered ?? false,
              pt.absHead || null,
              pt.err || null,
              pt.pitch || null,
              pt.roll || null,
              pt.lat || null,
              pt.lng || null,
              pt.sats || 0,
              pt.obsDist || null
            ]
          );
        }
      }

      await pool.query('COMMIT');
      return res.status(201).json({ ok: true, success: true, missionId: mission.id });
    } catch (err) {
      console.error('Failed to save mission to DB:', err);
      try { await pool.query('ROLLBACK'); } catch {}
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
