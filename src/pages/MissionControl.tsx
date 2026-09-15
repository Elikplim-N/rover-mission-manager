import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Wifi,
  WifiOff,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Settings2,
  Battery,
  Thermometer,
  Satellite,
  Gauge,
  FolderOpen
} from 'lucide-react';
import {
  sendRoverCommand,
  fetchRoverStatus,
  getDokployConfig,
  saveDokployConfig,
  type RoverStatus
} from '../lib/api';
import { db } from '../lib/db';
import { generateId } from '../lib/utils';
import type { MissionRun, TelemetryRow } from '../types';

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface MissionParams {
  rows: number;
  drops: number;
  dropDist: number; // meters
  rowGap: number; // meters
  moist: number;
  speed: number;
  turn: number;
}

const DEFAULT_PARAMS: MissionParams = {
  rows: 10,
  drops: 20,
  dropDist: 0.25,
  rowGap: 0.75,
  moist: 450,
  speed: 190,
  turn: 150
};

export default function MissionControl() {
  const [directIp, setDirectIp] = useState(getDokployConfig().directRoverIp || '');
  const [connState, setConnState] = useState<ConnState>('disconnected');
  const [status, setStatus] = useState<RoverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<MissionParams>(DEFAULT_PARAMS);
  const [configApplied, setConfigApplied] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [loggedPoints, setLoggedPoints] = useState(0);
  const [hasRun, setHasRun] = useState(false);

  // Refs so the polling closure always sees the latest in-progress run
  // without re-registering the interval on every telemetry point.
  const runRef = useRef<MissionRun | null>(null);
  const lastSeqRef = useRef<number>(-1);
  const missionActiveRef = useRef(false);

  const poll = useCallback(async () => {
    const res = await fetchRoverStatus();
    if (!res.ok || !res.status) {
      setConnState('error');
      setError(res.error || 'Rover unreachable on the local network.');
      return;
    }
    setConnState('connected');
    setError(null);
    setStatus(res.status);

    const s = res.status;

    // A fresh mission start (missionActive flips false -> true) begins a new
    // local run. All logging happens on this device; nothing is sent anywhere
    // unless the operator later chooses to sync to the cloud from Mission Hub.
    if (s.missionActive && !missionActiveRef.current) {
      const run: MissionRun = {
        id: generateId(),
        configId: '',
        name: `Field Run ${new Date().toLocaleString()}`,
        startTime: new Date(),
        telemetry: [],
        tags: ['local-mission']
      };
      runRef.current = run;
      lastSeqRef.current = -1;
      setSavedRunId(null);
      setLoggedPoints(0);
      setHasRun(true);
    }
    missionActiveRef.current = s.missionActive;

    if (runRef.current && s.seq > 0 && s.seq !== lastSeqRef.current) {
      lastSeqRef.current = s.seq;
      const point: TelemetryRow = {
        row: s.row,
        drop: s.drop,
        synX: s.synX,
        synY: s.synY,
        gpsLat: s.sats > 0 ? s.lat : 'NoFix',
        gpsLng: s.sats > 0 ? s.lng : 'NoFix',
        moisture: s.moist,
        watered: s.watered ? 1 : 0,
        absHead: s.absHead,
        headErr: s.err,
        pitch: s.pitch,
        roll: s.roll,
        elev: s.elev,
        sats: s.sats
      };
      runRef.current.telemetry.push(point);
      setLoggedPoints(runRef.current.telemetry.length);
      await db.runs.put(runRef.current);
      setSavedRunId(runRef.current.id);
    }

    if (s.missionComplete && runRef.current && !runRef.current.endTime) {
      runRef.current.endTime = new Date();
      await db.runs.put(runRef.current);
      setSavedRunId(runRef.current.id);
    }
  }, []);

  useEffect(() => {
    if (connState === 'disconnected') return;
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, [connState, poll]);

  function handleConnect() {
    if (!directIp.trim()) {
      setError("Enter the rover's LAN IP address first.");
      return;
    }
    const cfg = getDokployConfig();
    cfg.directRoverIp = directIp.trim();
    saveDokployConfig(cfg);
    setConnState('connecting');
  }

  function handleDisconnect() {
    setConnState('disconnected');
    setStatus(null);
    runRef.current = null;
    lastSeqRef.current = -1;
    missionActiveRef.current = false;
    setHasRun(false);
  }

  async function applyConfig() {
    setDispatching(true);
    const res = await sendRoverCommand('config', {
      rows: params.rows,
      drops: params.drops,
      dropDist: params.dropDist,
      rowGap: params.rowGap,
      moist: params.moist,
      speed: params.speed,
      turn: params.turn
    });
    setDispatching(false);
    if (res.ok) {
      setConfigApplied(true);
      setTimeout(() => setConfigApplied(false), 2500);
    } else {
      setError(res.error || 'Failed to apply configuration.');
    }
  }

  async function startMission() {
    setDispatching(true);
    const res = await sendRoverCommand('start_mission');
    setDispatching(false);
    if (!res.ok) setError(res.error || 'Failed to start mission.');
  }

  async function pauseMission() {
    setDispatching(true);
    const res = await sendRoverCommand('pause_mission');
    setDispatching(false);
    if (!res.ok) setError(res.error || 'Failed to pause mission.');
  }

  async function resumeMission() {
    setDispatching(true);
    const res = await sendRoverCommand('resume_mission');
    setDispatching(false);
    if (!res.ok) setError(res.error || 'Failed to resume mission.');
  }

  const mode = status?.mode || 'IDLE';
  const rowsDone = status ? status.row - 1 + status.drop / Math.max(status.dropsPerRow, 1) : 0;
  const progressPct = status && status.totalRows > 0 ? Math.min(100, (rowsDone / status.totalRows) * 100) : 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Mission Control</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Connect to the rover over the local network, configure and run a planting mission, and
          log data straight to this device. No internet connection required.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 text-[11px] hover:underline">Dismiss</button>
        </div>
      )}

      {/* Step 1: Connect */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              connState === 'connected'
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
              {connState === 'connected' ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">1. Connect to Rover</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Join the rover's own WiFi network first, then connect below</p>
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
            connState === 'connected' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
            connState === 'connecting' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
            connState === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}>
            {connState === 'connected' ? `LINKED · MODE ${mode}` : connState.toUpperCase()}
          </span>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={directIp}
            onChange={(e) => setDirectIp(e.target.value)}
            placeholder="e.g. 192.168.4.1"
            disabled={connState === 'connected'}
            className="flex-1 text-sm font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 rounded-md text-gray-900 dark:text-white disabled:opacity-60"
          />
          {connState === 'connected' ? (
            <button onClick={handleDisconnect} className="bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded-md">
              Disconnect
            </button>
          ) : (
            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md">
              Connect
            </button>
          )}
        </div>
      </div>

      {connState === 'connected' && status && (
        <>
          {/* Live Telemetry Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={Battery} label="Battery" value={`${status.volt.toFixed(1)} V`} />
            <StatTile icon={Thermometer} label="Temp" value={`${status.tempC.toFixed(1)} C`} />
            <StatTile icon={Gauge} label="Soil Moisture" value={String(status.moist)} />
            <StatTile icon={Satellite} label="GPS Sats" value={String(status.sats)} />
          </div>

          {/* Step 2: Configure */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-3">
              <Settings2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">2. Configure Mission</h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumField label="Rows" value={params.rows} onChange={(v) => setParams(p => ({ ...p, rows: v }))} />
              <NumField label="Drops / Row" value={params.drops} onChange={(v) => setParams(p => ({ ...p, drops: v }))} />
              <NumField label="Drop Spacing (m)" step={0.05} value={params.dropDist} onChange={(v) => setParams(p => ({ ...p, dropDist: v }))} />
              <NumField label="Row Spacing (m)" step={0.05} value={params.rowGap} onChange={(v) => setParams(p => ({ ...p, rowGap: v }))} />
              <NumField label="Moisture Threshold" value={params.moist} onChange={(v) => setParams(p => ({ ...p, moist: v }))} />
              <NumField label="Drive Speed" value={params.speed} onChange={(v) => setParams(p => ({ ...p, speed: v }))} />
              <NumField label="Turn Speed" value={params.turn} onChange={(v) => setParams(p => ({ ...p, turn: v }))} />
            </div>

            <button
              onClick={applyConfig}
              disabled={dispatching || status.missionActive}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md"
            >
              {configApplied ? 'Configuration Applied' : 'Apply Configuration'}
            </button>
            {status.missionActive && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Pause or wait for mission completion to change configuration.
              </p>
            )}
          </div>

          {/* Step 3: Run */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 pb-3">
              <Play className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">3. Run Mission</h3>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>
                {status.missionComplete
                  ? `All ${status.totalRows} rows planted`
                  : `Row ${status.row} of ${status.totalRows} · Drop ${status.drop} of ${status.dropsPerRow}`}
              </span>
              <span>{status.missionComplete ? 'Complete' : mode}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPct}%` }} />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={startMission}
                disabled={dispatching || mode !== 'IDLE'}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md"
              >
                <Play className="w-4 h-4 fill-white" /> Start Mission
              </button>
              <button
                onClick={pauseMission}
                disabled={dispatching || mode !== 'AUTO'}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md"
              >
                <Pause className="w-4 h-4 fill-white" /> Pause
              </button>
              <button
                onClick={resumeMission}
                disabled={dispatching || mode !== 'PAUSED'}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-md"
              >
                <RotateCcw className="w-4 h-4" /> Resume
              </button>
              <Link
                to="/teleop"
                className="flex items-center gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400 text-sm font-medium px-4 py-2 rounded-md border border-red-200 dark:border-red-800"
              >
                Manual Override &amp; E-Stop
              </Link>
            </div>

            {status.missionComplete && (
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs px-4 py-3 rounded-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Mission complete. {loggedPoints} drops logged to this device.
                </span>
                {savedRunId && (
                  <Link to={`/mission/${savedRunId}`} className="underline font-medium">View Analysis</Link>
                )}
              </div>
            )}

            {!status.missionComplete && hasRun && (
              <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5" /> Logging live to this device &middot; {loggedPoints} drops recorded so far
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Battery; label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</div>
        <div className="text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => {
          const v = step ? parseFloat(e.target.value) : parseInt(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        className="w-full px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
      />
    </div>
  );
}
