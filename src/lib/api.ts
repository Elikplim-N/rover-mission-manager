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
  return {
    serverUrl: 'http://localhost:3001',
    autoSync: false,
    apiKey: '',
    directRoverIp: ''
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
  | 'test_arm';

export interface CommandResponse {
  ok: boolean;
  mode?: string;
  error?: string;
  source?: 'direct' | 'cloud';
}

export async function sendRoverCommand(action: RoverAction, params: Record<string, unknown> = {}): Promise<CommandResponse> {
  const config = getDokployConfig();

  // 1. Try Direct Rover LAN IP if configured for instant <20ms latency
  if (config.directRoverIp) {
    try {
      const cleanIp = config.directRoverIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const directUrl = `http://${cleanIp}:8080/cmd?action=${action}`;
      const res = await fetch(directUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(1200)
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, mode: data.mode, source: 'direct' };
      }
    } catch {
      // Fallback to Dokploy cloud relay
    }
  }

  // 2. Dispatch via Dokploy Cloud Relay API
  if (!config.serverUrl) {
    return { ok: false, error: 'Dokploy Server URL not configured.' };
  }

  const url = config.serverUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ action, params }),
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    return { ok: true, mode: data.mode, source: 'cloud' };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}

export async function fetchRoverCommandState(): Promise<{
  command?: { action: string; timestamp: string };
  roverState?: { mode: string; lastSeen: string | null; volt: number | null };
  error?: string;
}> {
  const config = getDokployConfig();
  if (!config.serverUrl) return { error: 'No server URL' };

  try {
    const url = config.serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${url}/api/command`, {
      signal: AbortSignal.timeout(2500)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { error: errorMsg };
  }
}
