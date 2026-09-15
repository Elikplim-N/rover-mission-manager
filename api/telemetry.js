import pool from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body || {};
  try {
    const [cmdRes] = await Promise.all([
      pool.query('SELECT id, action, params FROM rover_commands ORDER BY id DESC LIMIT 1'),
      pool.query(
        `UPDATE rover_status
         SET last_seen = NOW(),
             volt = COALESCE($1, volt),
             lat = COALESCE($2, lat),
             lng = COALESCE($3, lng),
             updated_at = NOW()
         WHERE id = 1`,
        [payload.volt ?? null, payload.lat ?? null, payload.lng ?? null]
      )
    ]);

    const activeCommand = cmdRes.rows[0]
      ? { id: cmdRes.rows[0].id, action: cmdRes.rows[0].action, params: cmdRes.rows[0].params }
      : { id: 0, action: 'stop', params: {} };

    return res.status(201).json({
      success: true,
      command: activeCommand
    });
  } catch (err) {
    console.error('Telemetry ingestion error:', err.message);
    return res.status(200).json({
      success: true,
      command: { id: 0, action: 'stop', params: {} }
    });
  }
}
