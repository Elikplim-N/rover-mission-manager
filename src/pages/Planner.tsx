import { useState } from 'react';
import { db } from '../lib/db';
import { generateId, generateArduinoCode, calculateGridPosition } from '../lib/utils';
import type { MissionConfig } from '../types';

export default function Planner() {
  const [config, setConfig] = useState<Partial<MissionConfig>>({
    totalRows: 10,
    totalDrops: 20,
    dropDistCm: 50,
    rowGapCm: 100,
    baseSpeed: 150,
    turnSpeed: 100,
    maxCorrection: 50,
    kp: 2.0,
    ki: 0.1,
    kd: 0.5,
    moistureThreshold: 400
  });

  const [showCode, setShowCode] = useState(false);
  const [savedName, setSavedName] = useState('');

  const handleChange = (field: keyof MissionConfig, value: number) => {
    if (isNaN(value)) return;
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  async function saveConfig() {
    const name = prompt('Enter mission name:');
    if (!name) return;

    const newConfig: MissionConfig = {
      id: generateId(),
      name,
      totalRows: config.totalRows || 10,
      totalDrops: config.totalDrops || 20,
      dropDistCm: config.dropDistCm || 50,
      rowGapCm: config.rowGapCm || 100,
      baseSpeed: config.baseSpeed || 150,
      turnSpeed: config.turnSpeed || 100,
      maxCorrection: config.maxCorrection || 50,
      kp: config.kp || 2.0,
      ki: config.ki || 0.1,
      kd: config.kd || 0.5,
      moistureThreshold: config.moistureThreshold || 400,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.configs.add(newConfig);
    setSavedName(name);
    setTimeout(() => setSavedName(''), 3000);
  }

  function copyCode() {
    const code = generateArduinoCode(config);
    navigator.clipboard.writeText(code);
    alert('Arduino code copied to clipboard!');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Mission Planner</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure mission parameters and generate Arduino code
        </p>
      </div>

      {savedName && (
        <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-200 px-4 py-3 rounded">
          Mission "{savedName}" saved successfully!
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Grid Parameters</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Total Rows
                </label>
                <input
                  type="number"
                  value={config.totalRows}
                  onChange={(e) => handleChange('totalRows', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Total Drops per Row
                </label>
                <input
                  type="number"
                  value={config.totalDrops}
                  onChange={(e) => handleChange('totalDrops', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Drop Distance (cm)
                </label>
                <input
                  type="number"
                  value={config.dropDistCm}
                  onChange={(e) => handleChange('dropDistCm', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Row Gap (cm)
                </label>
                <input
                  type="number"
                  value={config.rowGapCm}
                  onChange={(e) => handleChange('rowGapCm', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Motor & PID</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Base Speed
                </label>
                <input
                  type="number"
                  value={config.baseSpeed}
                  onChange={(e) => handleChange('baseSpeed', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Turn Speed
                </label>
                <input
                  type="number"
                  value={config.turnSpeed}
                  onChange={(e) => handleChange('turnSpeed', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Max Correction
                </label>
                <input
                  type="number"
                  value={config.maxCorrection}
                  onChange={(e) => handleChange('maxCorrection', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Kp
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.kp}
                    onChange={(e) => handleChange('kp', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Ki
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.ki}
                    onChange={(e) => handleChange('ki', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Kd
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.kd}
                    onChange={(e) => handleChange('kd', parseFloat(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Moisture Threshold
                </label>
                <input
                  type="number"
                  value={config.moistureThreshold}
                  onChange={(e) => handleChange('moistureThreshold', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={saveConfig}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
            >
              Save Configuration
            </button>
            <button
              onClick={() => setShowCode(!showCode)}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
            >
              {showCode ? 'Hide' : 'Show'} Arduino Code
            </button>
          </div>

          {showCode && (
            <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">Arduino Code</h3>
                <button
                  onClick={copyCode}
                  className="text-sm bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded"
                >
                  Copy
                </button>
              </div>
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto text-xs">
                <code>{generateArduinoCode(config)}</code>
              </pre>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Path Preview</h3>
          <GridPreview config={config} />
        </div>
      </div>
    </div>
  );
}

function GridPreview({ config }: { config: Partial<MissionConfig> }) {
  const width = 600;
  const height = 400;
  const padding = 40;

  const totalRows = config.totalRows || 10;
  const totalDrops = config.totalDrops || 20;
  const dropDistCm = config.dropDistCm || 50;
  const rowGapCm = config.rowGapCm || 100;

  const maxX = (totalDrops - 1) * dropDistCm;
  const maxY = (totalRows - 1) * rowGapCm;

  const scaleX = (width - 2 * padding) / maxX;
  const scaleY = (height - 2 * padding) / maxY;
  const scale = Math.min(scaleX, scaleY);

  const points: { x: number; y: number }[] = [];

  for (let row = 1; row <= totalRows; row++) {
    for (let drop = 1; drop <= totalDrops; drop++) {
      const pos = calculateGridPosition(row, drop, totalDrops, dropDistCm, rowGapCm);
      points.push(pos);
    }
  }

  return (
    <div className="w-full overflow-hidden flex justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-w-full h-auto border border-gray-300 dark:border-gray-600 rounded-xl block"
      >
      {/* Grid lines */}
      {Array.from({ length: totalRows }).map((_, i) => {
        const y = padding + i * rowGapCm * scale;
        return (
          <line
            key={`row-${i}`}
            x1={padding}
            y1={y}
            x2={width - padding}
            y2={y}
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-gray-300 dark:text-gray-600"
          />
        );
      })}

      {/* Path */}
      {points.map((point, i) => {
        if (i === 0) return null;
        const prev = points[i - 1];
        return (
          <line
            key={`path-${i}`}
            x1={padding + prev.x * scale}
            y1={padding + prev.y * scale}
            x2={padding + point.x * scale}
            y2={padding + point.y * scale}
            stroke="currentColor"
            strokeWidth="2"
            className="text-blue-500"
          />
        );
      })}

      {/* Drop points */}
      {points.map((point, i) => (
        <circle
          key={`point-${i}`}
          cx={padding + point.x * scale}
          cy={padding + point.y * scale}
          r="3"
          fill="currentColor"
          className={i === 0 ? 'text-green-500' : i === points.length - 1 ? 'text-red-500' : 'text-blue-500'}
        />
      ))}
      </svg>
    </div>
  );
}
