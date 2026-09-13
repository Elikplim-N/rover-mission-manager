import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Play, Cloud, RefreshCw, CheckCircle2, AlertCircle, UploadCloud, FileUp } from 'lucide-react';
import { db } from '../lib/db';
import { parseTelemetryCSV, generateId } from '../lib/utils';
import { generateSampleMission } from '../lib/mockData';
import { getDokployConfig, saveDokployConfig, testDokployConnection, fetchCloudMissions, pushMissionToCloud } from '../lib/api';
import type { MissionRun } from '../types';

export default function Library() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<MissionRun[]>([]);
  const [uploading, setUploading] = useState(false);

  // Cloud Dokploy state
  const [showCloudConfig, setShowCloudConfig] = useState(false);
  const [cloudConfig, setCloudConfigState] = useState(getDokployConfig());
  const [cloudStatus, setCloudStatus] = useState<{ testing: boolean; message: string; ok?: boolean } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
    // Auto-fetch latest runs from Dokploy on load
    fetchCloudMissions()
      .then((res) => {
        if (res.imported > 0) {
          loadRuns();
          setSyncFeedback(`Auto-synced ${res.imported} new mission runs from Dokploy.`);
          setTimeout(() => setSyncFeedback(null), 4000);
        }
      })
      .catch(() => {});
  }, []);

  async function loadRuns() {
    const allRuns = await db.runs.toArray();
    setRuns(allRuns);
  }

  async function loadDemoMission() {
    const demo = generateSampleMission();
    await db.runs.add(demo);
    await loadRuns();
    navigate(`/mission/${demo.id}`);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const content = await file.text();
      const telemetry = parseTelemetryCSV(content);

      const name = prompt('Enter mission name:', file.name.replace('.csv', ''));
      if (!name) {
        setUploading(false);
        return;
      }

      const run: MissionRun = {
        id: generateId(),
        configId: '',
        name,
        startTime: new Date(),
        telemetry,
        tags: ['manual-import']
      };

      await db.runs.add(run);
      await loadRuns();
      setSyncFeedback('Mission imported locally!');
      setTimeout(() => setSyncFeedback(null), 4000);
    } catch (error) {
      alert('Error parsing CSV: ' + (error as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleTestConnection() {
    setCloudStatus({ testing: true, message: 'Connecting to Dokploy server...' });
    const res = await testDokployConnection(cloudConfig.serverUrl);
    setCloudStatus({ testing: false, ok: res.ok, message: res.message });
  }

  function handleSaveCloudConfig() {
    saveDokployConfig(cloudConfig);
    setSyncFeedback('Dokploy settings saved.');
    setTimeout(() => setSyncFeedback(null), 3000);
  }

  async function handleSyncFromCloud() {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await fetchCloudMissions();
      if (res.error) {
        setSyncFeedback(`Cloud sync failed: ${res.error}`);
      } else {
        await loadRuns();
        setSyncFeedback(`Synced ${res.imported} new/updated missions from Dokploy (${res.count} total in cloud).`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setSyncFeedback(`Error: ${errorMsg}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncFeedback(null), 6000);
    }
  }

  async function handlePushToCloud(run: MissionRun) {
    const res = await pushMissionToCloud(run);
    if (res.ok) {
      setSyncFeedback(`Mission "${run.name}" successfully pushed to Dokploy PostgreSQL database.`);
    } else {
      setSyncFeedback(`Push failed: ${res.error}`);
    }
    setTimeout(() => setSyncFeedback(null), 5000);
  }

  async function deleteRun(id: string) {
    if (!confirm('Delete this mission run?')) return;
    await db.runs.delete(id);
    await loadRuns();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Mission Hub</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Automated cloud telemetry stream from your Dokploy PostgreSQL database
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleSyncFromCloud}
            disabled={isSyncing}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sync from Cloud</span>
          </button>

          <button
            onClick={() => setShowCloudConfig(!showCloudConfig)}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 px-3 rounded-lg transition-colors flex items-center gap-1.5"
            title="Configure Dokploy Cloud Connection"
          >
            <Cloud className="w-4 h-4 text-blue-500" />
            <span>Connection</span>
          </button>

          <button
            onClick={loadDemoMission}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 px-3 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5 fill-gray-600 dark:fill-gray-300" />
            <span>Demo Run</span>
          </button>

          <label className="border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs font-medium py-2 px-2.5 rounded-lg cursor-pointer transition-colors flex items-center gap-1" title="Legacy CSV Import">
            <FileUp className="w-3.5 h-3.5" />
            <span>Import CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Dokploy Cloud Configuration Panel */}
      {showCloudConfig && (
        <div className="bg-white dark:bg-gray-800 border border-blue-100 dark:border-blue-900/50 shadow-sm rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Cloud className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Dokploy Cloud API Configuration</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Stream telemetry directly from your PostgreSQL 18.6 instance on Dokploy</p>
              </div>
            </div>
            <button
              onClick={() => setShowCloudConfig(false)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Dokploy Server Endpoint
              </label>
              <input
                type="text"
                value={cloudConfig.serverUrl}
                onChange={(e) => setCloudConfigState({ ...cloudConfig, serverUrl: e.target.value })}
                placeholder="http://178.105.184.157:3001 or https://rover-api.yourdomain.com"
                className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">Host endpoint where your rover-api container is exposed.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key / Token (Optional)
              </label>
              <input
                type="password"
                value={cloudConfig.apiKey || ''}
                onChange={(e) => setCloudConfigState({ ...cloudConfig, apiKey: e.target.value })}
                placeholder="Optional Bearer token"
                className="w-full text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">Optional authentication token if enabled in Dokploy.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between pt-2 gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={cloudStatus?.testing}
                className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium py-1.5 px-3 rounded-md transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${cloudStatus?.testing ? 'animate-spin' : ''}`} />
                <span>Test Connection</span>
              </button>

              <button
                type="button"
                onClick={handleSaveCloudConfig}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded-md transition-colors"
              >
                Save Settings
              </button>
            </div>
          </div>

          {cloudStatus && (
            <div className={`text-xs p-2.5 rounded-lg flex items-center gap-2 ${cloudStatus.ok ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
              {cloudStatus.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{cloudStatus.message}</span>
            </div>
          )}
        </div>
      )}

      {syncFeedback && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between">
          <span>{syncFeedback}</span>
          <button onClick={() => setSyncFeedback(null)} className="text-blue-500 hover:underline text-[11px]">Dismiss</button>
        </div>
      )}

      {uploading && (
        <div className="bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200 px-4 py-3 rounded-lg text-sm">
          Processing telemetry data...
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        {runs.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-950/60 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600 dark:text-blue-400">
              <Bot className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">No missions recorded yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
              Your rover streams missions automatically to Dokploy over Wi-Fi. Click below to fetch the latest field data, or launch a demo run.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={handleSyncFromCloud}
                disabled={isSyncing}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-5 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-95 flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Fetch from Dokploy Cloud</span>
              </button>
              <button
                onClick={loadDemoMission}
                className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold py-2.5 px-5 rounded-xl transition-all active:scale-95 flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                <span>Launch Demo Run</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-750">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Mission Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Points
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Tags
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {runs.map((run) => (
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {run.tags.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {run.tags.map((t, idx) => (
                            <span key={idx} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[11px] px-2 py-0.5 rounded">
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                      <button
                        onClick={() => handlePushToCloud(run)}
                        title="Sync/Backup to Dokploy PostgreSQL"
                        className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 inline-flex items-center gap-1 text-xs"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Cloud Backup</span>
                      </button>
                      <button
                        onClick={() => navigate(`/mission/${run.id}`)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 text-xs font-semibold"
                      >
                        View 3D
                      </button>
                      <button
                        onClick={() => deleteRun(run.id)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
