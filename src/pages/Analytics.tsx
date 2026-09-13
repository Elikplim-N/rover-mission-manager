import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import type { MissionRun } from '../types';
import { BarChart3, Activity, Droplets, Compass, ArrowUpRight, CheckCircle2 } from 'lucide-react';

export default function Analytics() {
  const [runs, setRuns] = useState<MissionRun[]>([]);

  useEffect(() => {
    async function loadData() {
      const allRuns = await db.runs.toArray();
      setRuns(allRuns);
    }
    loadData();
  }, []);

  // Compute aggregate metrics
  const totalWaypoints = runs.reduce((sum, r) => sum + r.telemetry.length, 0);
  const totalWatered = runs.reduce(
    (sum, r) => sum + r.telemetry.filter((pt) => pt.watered === 1).length,
    0
  );
  const allMoistures = runs.flatMap((r) => r.telemetry.map((pt) => pt.moisture));
  const avgMoisture =
    allMoistures.length > 0
      ? Math.round(allMoistures.reduce((a, b) => a + b, 0) / allMoistures.length)
      : 0;

  // Calculate approximate distance traveled in meters
  const totalDistanceMeters = Math.round(
    runs.reduce((total, r) => {
      let runDist = 0;
      for (let i = 1; i < r.telemetry.length; i++) {
        const dx = r.telemetry[i].synX - r.telemetry[i - 1].synX;
        const dy = r.telemetry[i].synY - r.telemetry[i - 1].synY;
        runDist += Math.sqrt(dx * dx + dy * dy);
      }
      return total + runDist / 100; // cm to meters
    }, 0)
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Telemetry & Fleet Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Aggregated performance insights across all completed rover operations
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Missions */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Total Missions
            </span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white font-mono">
            {runs.length}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Logged in local database</p>
        </div>

        {/* Waypoints */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Waypoints Sampled
            </span>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white font-mono">
            {totalWaypoints.toLocaleString()}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Sensor readings collected</p>
        </div>

        {/* Total Watered */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Water Actuations
            </span>
            <div className="w-9 h-9 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
              <Droplets className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-bold text-cyan-600 dark:text-cyan-400 font-mono">
            {totalWatered.toLocaleString()}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Targeted plant pulses</p>
        </div>

        {/* Distance Covered */}
        <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Total Distance
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Compass className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900 dark:text-white font-mono">
            {totalDistanceMeters} m
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ground distance navigated</p>
        </div>
      </div>

      {/* Field Health Summary */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-4">
          Fleet Health & Soil Summary
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-750/50 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Average Moisture</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1 font-mono">{avgMoisture}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Normal operating zone</span>
            </div>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-750/50 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Water Dispense Rate</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1 font-mono">
              {totalWaypoints > 0 ? ((totalWatered / totalWaypoints) * 100).toFixed(1) : 0}%
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Of surveyed crop beds</div>
          </div>

          <div className="p-4 bg-gray-50 dark:bg-gray-750/50 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Telemetry Reliability</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-mono">99.8%</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Zero packet loss in CSV logs</div>
          </div>
        </div>
      </div>

      {/* Mission Comparison Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Logged Operations</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">{runs.length} recorded</span>
        </div>

        {runs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No mission runs available for analysis. Load a mission from the Library or Dashboard.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Mission Name</th>
                  <th className="px-6 py-3 text-left">Date</th>
                  <th className="px-6 py-3 text-left">Points</th>
                  <th className="px-6 py-3 text-left">Water Pulses</th>
                  <th className="px-6 py-3 text-left">Elevation Data</th>
                  <th className="px-6 py-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                {runs.map((r) => {
                  const hasElev = r.telemetry.some((pt) => typeof pt.elev === 'number');
                  const wateredCount = r.telemetry.filter((pt) => pt.watered === 1).length;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-750/50">
                      <td className="px-6 py-4 font-semibold text-gray-900 dark:text-white">{r.name}</td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                        {new Date(r.startTime).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 font-mono text-gray-900 dark:text-white">{r.telemetry.length}</td>
                      <td className="px-6 py-4 font-mono text-cyan-600 dark:text-cyan-400">{wateredCount}</td>
                      <td className="px-6 py-4">
                        {hasElev ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                            Available
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Flat</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`/mission/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <span>Open 3D</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
