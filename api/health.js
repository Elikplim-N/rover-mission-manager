import pool from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const dbRes = await pool.query('SELECT NOW() as db_time, current_database() as db_name');
    return res.status(200).json({
      status: 'ok',
      service: 'rover-mission-manager-serverless',
      version: '1.2.0',
      database: 'connected',
      db: dbRes.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(200).json({
      status: 'degraded',
      service: 'rover-mission-manager-serverless',
      version: '1.2.0',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
}
