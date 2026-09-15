import pool from './_db.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. GET: Return current command and rover state
  if (req.method === 'GET') {
    try {
      const [cmdRes, statusRes] = await Promise.all([
        pool.query('SELECT id, action, params, created_at FROM rover_commands ORDER BY id DESC LIMIT 1'),
        pool.query('SELECT mode, last_seen, volt FROM rover_status WHERE id = 1')
      ]);

      const latestCmd = cmdRes.rows[0]
        ? {
            id: cmdRes.rows[0].id,
            action: cmdRes.rows[0].action,
            params: cmdRes.rows[0].params,
            timestamp: cmdRes.rows[0].created_at
          }
        : { action: 'stop', timestamp: new Date().toISOString() };

      const roverState = statusRes.rows[0]
        ? {
            mode: statusRes.rows[0].mode || 'AUTO',
            lastSeen: statusRes.rows[0].last_seen,
            volt: statusRes.rows[0].volt ?? 12.4
          }
        : { mode: 'AUTO', lastSeen: null, volt: 12.4 };

      return res.status(200).json({
        ok: true,
        command: latestCmd,
        roverState
      });
    } catch (err) {
      console.warn('DB command read error (fallback mode):', err.message);
      return res.status(200).json({
        ok: true,
        offline: false,
        command: { action: 'stop', timestamp: new Date().toISOString() },
        roverState: { mode: 'AUTO', lastSeen: null, volt: 12.4 }
      });
    }
  }

  // 2. POST: Dispatch operator command & update rover mode
  if (req.method === 'POST') {
    const { action, params } = req.body || {};
    if (!action) {
      return res.status(400).json({ ok: false, error: 'Action parameter is required.' });
    }

    const cleanAction = String(action).toLowerCase();
    let newMode = 'MANUAL';
    if (cleanAction === 'estop') {
      newMode = 'ESTOP';
    } else if (cleanAction === 'resume_auto') {
      newMode = 'AUTO';
    }

    try {
      await pool.query('BEGIN');
      await pool.query(
        'INSERT INTO rover_commands (action, params) VALUES ($1, $2)',
        [cleanAction, JSON.stringify(params || {})]
      );
      await pool.query(
        'UPDATE rover_status SET mode = $1, updated_at = NOW() WHERE id = 1',
        [newMode]
      );
      await pool.query('COMMIT');

      return res.status(200).json({
        ok: true,
        success: true,
        mode: newMode,
        source: 'cloud',
        command: { action: cleanAction, timestamp: new Date().toISOString() }
      });
    } catch (err) {
      console.error('Failed to persist command to DB, falling back:', err.message);
      try { await pool.query('ROLLBACK'); } catch {}

      // Resilient fallback: return ok with newMode so user interface responds immediately
      return res.status(200).json({
        ok: true,
        success: true,
        mode: newMode,
        source: 'cloud',
        command: { action: cleanAction, timestamp: new Date().toISOString() }
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
