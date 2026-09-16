import { db } from './db';
import type { MissionRun } from '../types';

const CLOUD_CONFIG_KEY = 'rover_dokploy_config';

export interface DokployConfig {
  serverUrl: string;
  autoSync: boolean;
  apiKey?: string;
  directRoverIp?: string; // Optional direct IP for LAN low-latency teleop (e.g. 192.168.4.1 or 192.168.1.150)
}

export function getDokployConfig(): DokployConfig {
  const saved = localStorage.getItem(CLOUD_CONFIG_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fallback
    }
  }
  const defaultUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? window.location.origin
    : 'http://localhost:3001';

  return {
    serverUrl: defaultUrl,
    autoSync: false,
    apiKey: '',
    // The rover hosts its own WiFi network and always comes up at this fixed
    // address, so a fresh install works as soon as the phone/laptop joins it.
    directRoverIp: '192.168.4.1'
  };
}

export function saveDokployConfig(config: DokployConfig): void {
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
}

export async function testDokployConnection(serverUrl: string): Promise<{ ok: boolean; message: string; version?: string }> {
  try {
    const url = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${url}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      return { ok: false, message: `Server returned HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    return { ok: true, message: 'Connected to Dokploy Rover API', version: data.version || '1.1.0' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection failed: ${errorMsg}` };
  }
}

export async function fetchCloudMissions(): Promise<{ count: number; imported: number; error?: string }> {
  const config = getDokployConfig();
  if (!config.serverUrl) {
    return { count: 0, imported: 0, error: 'Dokploy Server URL not configured.' };
  }

  const url = config.serverUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    const res = await fetch(`${url}/api/missions`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const cloudMissions: MissionRun[] = await res.json();
    let imported = 0;

    for (const mission of cloudMissions) {
      const existing = await db.runs.get(mission.id);
      if (!existing || (mission.telemetry && mission.telemetry.length > (existing.telemetry?.length || 0))) {
        await db.runs.put({
          ...mission,
          startTime: new Date(mission.startTime),
          endTime: mission.endTime ? new Date(mission.endTime) : undefined
        });
        imported++;
      }
    }

    return { count: cloudMissions.length, imported };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { count: 0, imported: 0, error: errorMsg };
  }
}

export async function pushMissionToCloud(mission: MissionRun): Promise<{ ok: boolean; error?: string }> {
  const config = getDokployConfig();
  if (!config.serverUrl) {
    return { ok: false, error: 'Dokploy Server URL not configured.' };
  }

  const url = config.serverUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  try {
    const res = await fetch(`${url}/api/missions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(mission)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return { ok: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

// =========================================================================
// TELEOPERATION & REMOTE E-STOP CLIENT API
// =========================================================================

// The rover's WiFiServer on port 8080 is a single-threaded, single-client-
// at-a-time Arduino HTTP server. Mission Control polls it for status every
// 1.5s in the background while the operator can also dispatch a command
// (including the auto-start countdown) at any moment, including mid-poll.
// Two overlapping requests hitting that tiny server back-to-back is a
// plausible way to get a garbled/interleaved response on one of them, so
// every request to the rover is funneled through this queue to guarantee
// only one is ever in flight at a time.
let roverRequestQueue: Promise<unknown> = Promise.resolve();

function queueRoverRequest<T>(run: () => Promise<T>): Promise<T> {
  const result = roverRequestQueue.then(run, run);
  roverRequestQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export type RoverAction =
  | 'estop'
  | 'clear_estop'
  | 'resume_auto'
  | 'forward'
  | 'reverse'
  | 'left'
  | 'right'
  | 'stop'
  | 'test_seed'
  | 'test_water'
  | 'test_arm'
  | 'config'
  | 'start_mission'
  | 'pause_mission'
  | 'resume_mission'
  | 'status';

// Response shape for the 'status' action: the rover's latest telemetry
// snapshot and mission progress, for local (offline) logging on the device
// running the app rather than a cloud database.
export interface RoverStatus {
  ok: boolean;
  mode: 'IDLE' | 'AUTO' | 'PAUSED' | 'MANUAL' | 'ESTOP';
  missionActive: boolean;
  missionComplete: boolean;
  row: number;
  drop: number;
  totalRows: number;
  dropsPerRow: number;
  seq: number;
  synX: number; synY: number;
  volt: number; tempC: number; hum: number; press: number; elev: number;
  moist: number; watered: boolean;
  absHead: number; err: number; pitch: number; roll: number;
  lat: number; lng: number; sats: number; obsDist: number;
}

export interface CommandResponse {
  ok: boolean;
  mode?: string;
  error?: string;
  source?: 'direct' | 'cloud';
}

export async function sendRoverCommand(action: RoverAction, params: Record<string, unknown> = {}): Promise<CommandResponse> {
  const config = getDokployConfig();

  // The rover only ever receives commands over its own local Access Point.
  // There used to be a cloud-relay fallback here, but it relied on the rover
  // polling the cloud API for queued commands, and that polling was removed
  // when the firmware switched to Access Point mode (it has no internet path
  // at all now). Falling back to the cloud here would either fail confusingly
  // or, worse, report a false "success" that never reaches the physical
  // rover, so this only ever talks to the rover directly.
  const roverIp = config.directRoverIp;
  if (!roverIp) {
    return { ok: false, error: "No rover IP configured. Connect this device to the rover's own WiFi network first." };
  }

  return queueRoverRequest(async () => {
    try {
      const cleanIp = roverIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const query = new URLSearchParams({ action, ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ) }).toString();
      const directUrl = `http://${cleanIp}:8080/cmd?${query}`;
      const res = await fetch(directUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(1200)
      });
      if (!res.ok) {
        return { ok: false, error: `Rover returned HTTP ${res.status}` };
      }
      const data = await res.json();
      return { ok: true, mode: data.mode, source: 'direct' };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not reach the rover at ${roverIp}: ${errorMsg}` };
    }
  });
}

// Polls the rover directly over the LAN for its full mission/telemetry
// snapshot. Local-first: requires directRoverIp, since mission control and
// on-device logging must keep working with no internet connection at all.
export async function fetchRoverStatus(): Promise<{ ok: boolean; status?: RoverStatus; error?: string }> {
  const config = getDokployConfig();
  const roverIp = config.directRoverIp;
  if (!roverIp) {
    return { ok: false, error: 'No direct rover IP configured.' };
  }

  return queueRoverRequest(async () => {
    try {
      const cleanIp = roverIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const res = await fetch(`http://${cleanIp}:8080/cmd?action=status`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500)
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
      }
      const data: RoverStatus = await res.json();
      return { ok: true, status: data };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: errorMsg };
    }
  });
}

export async function fetchRoverCommandState(): Promise<{
  command?: { action: string; timestamp: string };
  roverState?: { mode: string; lastSeen: string | null; volt: number | null };
  offline?: boolean;
  error?: string;
}> {
  const config = getDokployConfig();
  if (!config.serverUrl) return { offline: true, error: 'No server URL' };

  try {
    const url = config.serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${url}/api/command`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) {
      return { offline: true, error: `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { offline: true, error: errorMsg };
  }
}
