import { useState, useEffect, useCallback } from 'react';
import {
  OctagonAlert,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Square,
  Sprout,
  Droplet,
  Wrench,
  Play,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Cpu
} from 'lucide-react';
import {
  sendRoverCommand,
  fetchRoverCommandState,
  getDokployConfig,
  saveDokployConfig,
  type RoverAction
} from '../lib/api';

export default function Teleop() {
  const [roverMode, setRoverMode] = useState<'AUTO' | 'MANUAL' | 'ESTOP'>('AUTO');
  const [lastAction, setLastAction] = useState<string>('idle');
  const [lastSource, setLastSource] = useState<'direct' | 'cloud' | null>(null);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  
  // IP config for direct low-latency LAN teleop
  const [directIp, setDirectIp] = useState<string>(getDokployConfig().directRoverIp || '');
  const [showIpConfig, setShowIpConfig] = useState<boolean>(false);
  const [cloudConnected, setCloudConnected] = useState<boolean | null>(null);

  const syncState = useCallback(async () => {
    const data = await fetchRoverCommandState();
    if (data.offline || data.error) {
      setCloudConnected(false);
    } else {
      setCloudConnected(true);
    }
    if (data.roverState?.mode) {
      setRoverMode(data.roverState.mode as 'AUTO' | 'MANUAL' | 'ESTOP');
    }
  }, []);

  useEffect(() => {
    syncState();
    const intervalMs = cloudConnected === false ? 15000 : 3000;
    const interval = setInterval(syncState, intervalMs);
    return () => clearInterval(interval);
  }, [syncState, cloudConnected]);

  const handleCommand = useCallback(async (action: RoverAction) => {
    setDispatching(true);
    setLastAction(action);
    try {
      const res = await sendRoverCommand(action);
      if (res.ok) {
        if (action === 'estop') {
          setRoverMode('ESTOP');
        } else if (action === 'resume_auto') {
          setRoverMode('AUTO');
        } else {
          setRoverMode('MANUAL');
        }
        setLastSource(res.source || 'cloud');
        setFeedback(`Command "${action}" dispatched via ${res.source === 'direct' ? 'Direct LAN' : 'Dokploy Cloud'}`);
      } else {
        setFeedback(`Command failed: ${res.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback(`Error: ${msg}`);
    } finally {
      setDispatching(false);
      setTimeout(() => setFeedback(null), 3500);
    }
  }, []);

  // Keyboard navigation listener for W, A, S, D and Arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        handleCommand('stop');
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleCommand('forward');
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleCommand('reverse');
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handleCommand('left');
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        handleCommand('right');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCommand]);

  function handleSaveDirectIp() {
    const cfg = getDokployConfig();
    cfg.directRoverIp = directIp.trim();
    saveDokployConfig(cfg);
    setShowIpConfig(false);
    setFeedback('Direct Rover LAN IP saved.');
    setTimeout(() => setFeedback(null), 3000);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Manual Override & Emergency Defense
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Real-time manual teleoperation, remote E-Stop safety, and individual actuator diagnostics
          </p>
        </div>

        {/* State Badge, Link Badge & Direct IP Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Link Status Indicator */}
          <div
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border ${
              directIp
                ? 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                : cloudConnected === true
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                directIp
                  ? 'bg-blue-500 animate-pulse'
                  : cloudConnected === true
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-amber-500'
              }`}
            />
            <span>
              {directIp
                ? `LAN (${directIp})`
                : cloudConnected === true
                ? 'Cloud Relay Online'
                : 'Standalone / Cloud Standby'}
            </span>
          </div>

          <button
            onClick={() => setShowIpConfig(!showIpConfig)}
            className="text-xs border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 py-1.5 px-3 rounded-lg flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5 text-blue-500" />
            <span>LAN Direct IP</span>
          </button>

          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
              roverMode === 'ESTOP'
                ? 'bg-red-600 text-white animate-pulse'
                : roverMode === 'MANUAL'
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
            }`}
          >
            {roverMode === 'ESTOP' ? (
              <>
                <ShieldAlert className="w-4 h-4" />
                <span>STATE: EMERGENCY STOP</span>
              </>
            ) : roverMode === 'MANUAL' ? (
              <>
                <Wrench className="w-4 h-4" />
                <span>STATE: MANUAL OVERRIDE</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>STATE: AUTONOMOUS MISSION</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* LAN IP Config Dropdown */}
      {showIpConfig && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-xl shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              Direct Rover Subnet IP (Optional Low-Latency Link)
            </span>
            <button onClick={() => setShowIpConfig(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={directIp}
              onChange={(e) => setDirectIp(e.target.value)}
              placeholder="e.g. 192.168.4.1 or 192.168.1.150"
              className="text-xs font-mono border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-md text-gray-900 dark:text-white flex-1"
            />
            <button
              onClick={handleSaveDirectIp}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-md"
            >
              Save IP
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            If left empty or unreachable, all commands transparently relay through your Dokploy Cloud server.
          </p>
        </div>
      )}

      {/* Feedback Alert */}
      {feedback && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-blue-500 text-[11px] hover:underline">Dismiss</button>
        </div>
      )}

      {/* EMERGENCY STOP BANNER & TRIGGER */}
      <div className="bg-red-50 dark:bg-red-950/30 border-2 border-red-500 dark:border-red-700 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/30 shrink-0">
            <OctagonAlert className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-red-900 dark:text-red-200">
              Remote Safety E-Stop
            </h3>
            <p className="text-xs text-red-700 dark:text-red-300 max-w-xl">
              Immediately cuts all motor PWM power, forces irrigation pump relay shut, sounds the acoustic warning horn, and freezes the autonomous state machine.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          {roverMode === 'ESTOP' ? (
            <button
              onClick={() => handleCommand('clear_estop')}
              disabled={dispatching}
              className="bg-gray-900 hover:bg-black text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md active:scale-95 text-sm"
            >
              Clear E-Stop
            </button>
          ) : (
            <button
              onClick={() => handleCommand('estop')}
              disabled={dispatching}
              className="w-full md:w-auto bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-black py-4 px-8 rounded-xl shadow-lg shadow-red-600/40 text-base tracking-wider uppercase transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <OctagonAlert className="w-6 h-6" />
              <span>EMERGENCY STOP</span>
            </button>
          )}
        </div>
      </div>

      {/* Teleoperation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Drive Control Section */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Directional Drive Control
              </h3>
            </div>
            <span className="text-[11px] text-gray-400">Arrow keys / WASD enabled</span>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Nudge rover forward, reverse, or turn to align with furrow rows or recover from field obstacles.
          </p>

          {/* Drive Pad */}
          <div className="flex flex-col items-center justify-center py-4 space-y-2 select-none">
            {/* Forward */}
            <button
              onClick={() => handleCommand('forward')}
              disabled={roverMode === 'ESTOP' || dispatching}
              className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white text-gray-700 dark:text-gray-200 flex items-center justify-center transition-colors shadow-xs active:scale-95 disabled:opacity-40"
              title="Drive Forward (W / Up Arrow)"
            >
              <ArrowUp className="w-6 h-6" />
            </button>

            {/* Left / Stop / Right */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCommand('left')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white text-gray-700 dark:text-gray-200 flex items-center justify-center transition-colors shadow-xs active:scale-95 disabled:opacity-40"
                title="Pivot Left (A / Left Arrow)"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>

              <button
                onClick={() => handleCommand('stop')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="w-16 h-16 rounded-xl bg-gray-200 dark:bg-gray-600 hover:bg-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:text-white text-gray-800 dark:text-gray-100 flex items-center justify-center transition-colors shadow-xs active:scale-95 disabled:opacity-40 font-bold text-xs"
                title="Stop Motors (Space / Esc)"
              >
                <Square className="w-5 h-5 fill-current" />
              </button>

              <button
                onClick={() => handleCommand('right')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white text-gray-700 dark:text-gray-200 flex items-center justify-center transition-colors shadow-xs active:scale-95 disabled:opacity-40"
                title="Pivot Right (D / Right Arrow)"
              >
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>

            {/* Reverse */}
            <button
              onClick={() => handleCommand('reverse')}
              disabled={roverMode === 'ESTOP' || dispatching}
              className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white text-gray-700 dark:text-gray-200 flex items-center justify-center transition-colors shadow-xs active:scale-95 disabled:opacity-40"
              title="Drive Reverse (S / Down Arrow)"
            >
              <ArrowDown className="w-6 h-6" />
            </button>
          </div>

          <div className="flex justify-between items-center text-[11px] text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
            <span>Last Command: <strong className="text-gray-700 dark:text-gray-300 uppercase font-mono">{lastAction}</strong></span>
            <span>Channel: <strong className="text-blue-600 font-mono">{lastSource || 'N/A'}</strong></span>
          </div>
        </div>

        {/* Actuator Diagnostics & Mode Section */}
        <div className="space-y-6">
          {/* Actuator Test Bench */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="border-b border-gray-100 dark:border-gray-700 pb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Actuator Diagnostic Test Bench
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Verify individual actuators for thesis defense demo without running a full mission
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {/* Seed Dispenser */}
              <button
                onClick={() => handleCommand('test_seed')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-500 dark:hover:border-emerald-500 bg-gray-50 dark:bg-gray-750 transition-colors group text-left disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Sprout className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 dark:text-white">
                      Test Seed Dispenser (Hopper Servo D10)
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      Rotates gate 60° for 180ms to drop a single maize kernel
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-emerald-600 group-hover:underline">Pulse</span>
              </button>

              {/* Water Pump */}
              <button
                onClick={() => handleCommand('test_water')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-500 bg-gray-50 dark:bg-gray-750 transition-colors group text-left disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Droplet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 dark:text-white">
                      Test Irrigation Pump (Relay D7)
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      Activates pump for 400ms micro-dose pulse
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-blue-600 group-hover:underline">Pulse</span>
              </button>

              {/* Articulated Arm */}
              <button
                onClick={() => handleCommand('test_arm')}
                disabled={roverMode === 'ESTOP' || dispatching}
                className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-500 dark:hover:border-indigo-500 bg-gray-50 dark:bg-gray-750 transition-colors group text-left disabled:opacity-40"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Wrench className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 dark:text-white">
                      Toggle Tool Arm (Servo D12)
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      Alternates arm between transit (90°) and furrow soil depth (0°)
                    </div>
                  </div>
                </div>
                <span className="text-xs font-medium text-indigo-600 group-hover:underline">Toggle</span>
              </button>
            </div>
          </div>

          {/* Autonomous Resume Switch */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-xs flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-gray-900 dark:text-white">
                Hand Back to Autonomous Mission
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Resumes autonomous furrow path planning and boustrophedon planting loop
              </p>
            </div>
            <button
              onClick={() => handleCommand('resume_auto')}
              disabled={roverMode === 'ESTOP' || dispatching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Resume Auto</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
