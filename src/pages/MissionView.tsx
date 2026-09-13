import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, Check } from 'lucide-react';
import { db } from '../lib/db';
import Terrain3D from '../components/Terrain3D';
import type { MissionRun } from '../types';

export default function MissionView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [mission, setMission] = useState<MissionRun | null>(null);

  useEffect(() => {
    loadMission();
  }, [id]);

  async function loadMission() {
    if (!id) return;
    const run = await db.runs.get(id);
    if (run) {
      setMission(run);
    }
  }

  if (!mission) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Loading mission...</p>
      </div>
    );
  }

  const stats = {
    totalPoints: mission.telemetry.length,
    watered: mission.telemetry.filter(t => t.watered === 1).length,
    avgMoisture: Math.round(
      mission.telemetry.reduce((sum, t) => sum + t.moisture, 0) / mission.telemetry.length
    ),
    minMoisture: Math.min(...mission.telemetry.map(t => t.moisture)),
    maxMoisture: Math.max(...mission.telemetry.map(t => t.moisture)),
    hasElevation: mission.telemetry.some(t => t.elev !== undefined)
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <button
            onClick={() => navigate('/library')}
            className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 mb-2"
          >
            ← Back to Library
          </button>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">{mission.name}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {new Date(mission.startTime).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Points</div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white mt-1">
            {stats.totalPoints}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Watered</div>
          <div className="text-2xl font-semibold text-green-600 dark:text-green-400 mt-1">
            {stats.watered}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Avg Moisture</div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white mt-1">
            {stats.avgMoisture}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Min Moisture</div>
          <div className="text-2xl font-semibold text-red-600 dark:text-red-400 mt-1">
            {stats.minMoisture}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">Max Moisture</div>
          <div className="text-2xl font-semibold text-blue-600 dark:text-blue-400 mt-1">
            {stats.maxMoisture}
          </div>
        </div>
      </div>

      {/* 3D Terrain Visualization */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span>3D Field Terrain & Rover Simulation</span>
              {stats.hasElevation && (
                <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 font-mono px-2 py-0.5 rounded-full">
                  Elevation Active
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Interactive WebGL terrain model, real-time rover kinematics, variable-rate moisture mapping, and mission playback.
            </p>
          </div>
        </div>
        <Terrain3D telemetry={mission.telemetry} showGPS={true} />
      </div>

      {/* 2D Path Visualization */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">2D Mission Path</h3>
        <PathVisualization telemetry={mission.telemetry} />
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">Telemetry Data</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Row</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Drop</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">X (cm)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Y (cm)</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Moisture</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Watered</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Heading</th>
                {stats.hasElevation && (
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Elev (m)</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {mission.telemetry.map((point, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{point.row}</td>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">{point.drop}</td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{point.synX}</td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{point.synY}</td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <span className={point.moisture < 400 ? 'text-red-600 dark:text-red-400' : ''}>
                      {point.moisture}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {point.watered ? (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 inline" />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                    {point.absHead.toFixed(1)}°
                  </td>
                  {stats.hasElevation && (
                    <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {point.elev?.toFixed(2) || '-'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PathVisualization({ telemetry }: { telemetry: any[] }) {
  if (telemetry.length === 0) return null;

  const width = 800;
  const height = 500;
  const padding = 40;

  const maxX = Math.max(...telemetry.map(t => t.synX));
  const maxY = Math.max(...telemetry.map(t => t.synY));

  const scaleX = (width - 2 * padding) / maxX;
  const scaleY = (height - 2 * padding) / maxY;
  const scale = Math.min(scaleX, scaleY);

  return (
    <div className="w-full overflow-hidden flex justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-3xl h-auto border border-gray-200 dark:border-gray-700 rounded-xl block"
      >
      {/* Grid */}
      <rect
        x={padding}
        y={padding}
        width={maxX * scale}
        height={maxY * scale}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        className="text-gray-300 dark:text-gray-600"
      />

      {/* Path lines */}
      {telemetry.map((point, i) => {
        if (i === 0) return null;
        const prev = telemetry[i - 1];
        return (
          <line
            key={`line-${i}`}
            x1={padding + prev.synX * scale}
            y1={padding + prev.synY * scale}
            x2={padding + point.synX * scale}
            y2={padding + point.synY * scale}
            stroke="currentColor"
            strokeWidth="2"
            className="text-blue-500 dark:text-blue-400"
          />
        );
      })}

      {/* Points */}
      {telemetry.map((point, i) => (
        <circle
          key={`point-${i}`}
          cx={padding + point.synX * scale}
          cy={padding + point.synY * scale}
          r={point.watered ? 6 : 4}
          fill="currentColor"
          className={
            point.watered
              ? 'text-green-500 dark:text-green-400'
              : point.moisture < 400
              ? 'text-red-500 dark:text-red-400'
              : 'text-blue-500 dark:text-blue-400'
          }
        />
      ))}
      </svg>
    </div>
  );
}
