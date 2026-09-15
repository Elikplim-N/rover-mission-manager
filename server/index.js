import express from 'express';
import cors from 'cors';
import { initDB, saveMission, appendTelemetryPoint, getAllMissions, getMissionById, getPostgresStatus } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// In-memory Command Relay State for Low-Latency Remote Teleop & E-Stop
let commandSequence = 0;
let activeCommand = {
  id: 0,
  action: 'stop',
  params: {},
  timestamp: new Date().toISOString()
};

let roverTelemetryState = {
  mode: 'AUTO', // 'AUTO' | 'MANUAL' | 'ESTOP'
  lastSeen: null,
  volt: null,
  lat: null,
  lng: null
};

// Health Check for Dokploy Monitoring & Web App Connectivity Test
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'rover-mission-dokploy-server',
    version: '1.1.0',
    database: getPostgresStatus() ? 'connected' : 'unavailable (in-memory fallback)',
    timestamp: new Date().toISOString()
  });
});

// GET all missions (for Web App Dashboard & Library)
app.get('/api/missions', async (req, res) => {
  try {
    const missions = await getAllMissions();
    res.json(missions);
  } catch (err) {
    console.error('Failed to get missions:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single mission by ID
app.get('/api/missions/:id', async (req, res) => {
  try {
    const mission = await getMissionById(req.params.id);
    if (!mission) {
      return res.status(404).json({ error: 'Mission not found' });
    }
    res.json(mission);
  } catch (err) {
    console.error('Failed to get mission:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST complete mission run (batch upload from Web App)
app.post('/api/missions', async (req, res) => {
  try {
    const mission = req.body;
    if (!mission || !mission.id) {
      return res.status(400).json({ error: 'Invalid mission payload. Missing id.' });
    }
    const saved = await saveMission(mission);
    res.status(201).json({ success: true, mission: saved });
  } catch (err) {
    console.error('Failed to save mission:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST single drop telemetry point (direct HTTP POST from Arduino Uno R4 WiFi in field)
app.post('/api/telemetry', async (req, res) => {
  try {
    const payload = req.body;
    const point = await appendTelemetryPoint(payload);

    roverTelemetryState.lastSeen = new Date().toISOString();
    if (payload.volt) roverTelemetryState.volt = payload.volt;
    if (payload.lat) roverTelemetryState.lat = payload.lat;
    if (payload.lng) roverTelemetryState.lng = payload.lng;

    res.status(201).json({
      success: true,
      recorded: point,
      command: activeCommand // Pigs-back next command in response
    });
  } catch (err) {
    console.error('Failed to record telemetry point:', err);
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// TELEOP & REMOTE E-STOP API
// =========================================================================

// POST operator command (E-Stop, Drive, Actuator test, Mode switch)
app.post('/api/command', (req, res) => {
  const { action, params } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'Action parameter is required.' });
  }

  commandSequence++;
  activeCommand = {
    id: commandSequence,
    action: action.toLowerCase(),
    params: params || {},
    timestamp: new Date().toISOString()
  };

  if (action === 'estop') {
    roverTelemetryState.mode = 'ESTOP';
  } else if (action === 'resume_auto') {
    roverTelemetryState.mode = 'AUTO';
  } else {
    roverTelemetryState.mode = 'MANUAL';
  }

  console.log(`[Command] Dispatched: ${action.toUpperCase()} (ID: ${commandSequence})`);
  res.json({ success: true, command: activeCommand, mode: roverTelemetryState.mode });
});

// GET active command (polled by rover or web app status)
app.get('/api/command', (req, res) => {
  res.json({
    command: activeCommand,
    roverState: roverTelemetryState
  });
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Rover Mission Dokploy API running on port ${PORT}`);
  });
});
