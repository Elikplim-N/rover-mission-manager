import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, Plus, FileCode, Activity, MapPin, Cloud, RefreshCw } from 'lucide-react';
import { db } from '../lib/db';
import { generateSampleMission } from '../lib/mockData';
import { fetchCloudMissions } from '../lib/api';
import type { MissionRun } from '../types';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalConfigs: 0,
    totalRuns: 0,
    totalFields: 0,
    recentRuns: [] as MissionRun[]
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const configs = await db.configs.count();
    const runs = await db.runs.count();
    const fields = await db.fields.count();
    const recentRuns = await db.runs.orderBy('startTime').reverse().limit(5).toArray();

    setStats({
      totalConfigs: configs,
      totalRuns: runs,
      totalFields: fields,
      recentRuns
    });
  }

  async function loadDemo() {
    const demo = generateSampleMission();
    await db.runs.add(demo);
    navigate(`/mission/${demo.id}`);
  }

  async function handleCloudSync() {
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const res = await fetchCloudMissions();
      if (res.error) {
        setSyncNotice(`Dokploy sync error: ${res.error}`);
      } else {
        await loadStats();
        setSyncNotice(`Synced ${res.imported} new missions from Dokploy.`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setSyncNotice(`Sync failed: ${errorMsg}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncNotice(null), 5000);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Field operations, fleet telemetry, and mission telemetry overview
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleCloudSync}
            disabled={isSyncing}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 px-3 rounded-lg transition-colors flex items-center gap-1.5"
            title="Sync latest telemetry runs from Dokploy Cloud"
          >
            <Cloud className="w-4 h-4 text-blue-500" />
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Dokploy Cloud Sync</span>
          </button>
        </div>
      </div>

      {syncNotice && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{syncNotice}</span>
          <button onClick={() => setSyncNotice(null)} className="text-blue-500 hover:underline text-[11px]">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow-xs rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Mission Configs
              </dt>
              <dd className="mt-1 text-3xl font-bold text-gray-900 dark:text-white font-mono">
                {stats.totalConfigs}
              </dd>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <FileCode className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow-xs rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Completed Runs
              </dt>
              <dd className="mt-1 text-3xl font-bold text-gray-900 dark:text-white font-mono">
                {stats.totalRuns}
              </dd>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 overflow-hidden shadow-xs rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between">
            <div>
              <dt className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Managed Fields
              </dt>
              <dd className="mt-1 text-3xl font-bold text-gray-900 dark:text-white font-mono">
                {stats.totalFields}
              </dd>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow-xs rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Missions
          </h3>
          {stats.recentRuns.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                No missions recorded yet. Get started by launching the 3D simulation or creating a mission.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={loadDemo}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Launch 3D Demo Mission</span>
                </button>
                <Link
                  to="/planner"
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Mission Plan</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead>
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Data Points
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {stats.recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {run.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {new Date(run.startTime).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">
                        {run.telemetry.length}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          to={`/mission/${run.id}`}
                          className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 font-medium text-xs"
                        >
                          View 3D & Analytics
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Link to="/planner" className="block bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Create New Mission</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Plan a new mission with custom parameters, grid geometry, and preview the path
          </p>
        </Link>

        <Link to="/library" className="block bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-md transition-shadow border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Cloud Missions & Fleet Telemetry</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Stream and synchronize live field runs directly from your Dokploy PostgreSQL database
          </p>
        </Link>
      </div>
    </div>
  );
}
