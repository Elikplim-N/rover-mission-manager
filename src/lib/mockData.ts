import type { MissionRun, TelemetryRow } from '../types';
import { generateId } from './utils';

export function generateSampleMission(name = 'Farm Plot Alpha - Rugged Field & Planting'): MissionRun {
  const rows = 8;
  const dropsPerRow = 18;
  const dropDistCm = 50;
  const rowGapCm = 80;
  const baseLat = 5.6037; // Research field coords
  const baseLng = -0.1870;

  const telemetry: TelemetryRow[] = [];

  for (let r = 1; r <= rows; r++) {
    const isOdd = r % 2 === 1;
    const yCm = (r - 1) * rowGapCm;

    for (let d = 1; d <= dropsPerRow; d++) {
      const dropIndex = isOdd ? d : dropsPerRow - d + 1;
      const xCm = (dropIndex - 1) * dropDistCm;

      // Normalized coordinates (0.0 to 1.0)
      const nx = xCm / ((dropsPerRow - 1) * dropDistCm);
      const ny = yCm / ((rows - 1) * rowGapCm);

      // 1. Natural rolling agricultural slope (gentle 0.5m rise across the field)
      const fieldSlope = 0.35 * Math.sin(nx * Math.PI * 0.9) + 0.25 * (1 - ny);
      
      // 2. Gentle parallel crop bed ridges (~10cm height along rows)
      const bedRidge = 0.10 * Math.sin(ny * Math.PI * 7.0);

      // Total natural elevation (realistic 2.5m to ~3.2m range)
      const elevation = parseFloat((2.50 + fieldSlope + bedRidge).toFixed(2));

      // Moisture dynamics: lower on exposed mounds, higher in damp depressions
      const rawMoisture = 560 - (fieldSlope * 120) - (bedRidge * 80) + Math.sin(nx * 4) * 30;
      const moisture = Math.max(220, Math.min(780, Math.round(rawMoisture)));

      // Watered if moisture is low (< 440) or on scheduled spot-checks
      const watered: 0 | 1 = moisture < 440 || (r === 3 && d === 7) || (r === 5 && d === 11) ? 1 : 0;

      // Heading: 90° heading east, 270° heading west
      const targetHead = isOdd ? 90 : 270;
      const headJitter = Math.sin(nx * 6) * 2.0;
      const absHead = (targetHead + headJitter + 360) % 360;

      // Realistic Pitch & Roll matching the gentle slope
      const pitch = (isOdd ? 1 : -1) * (Math.cos(nx * Math.PI * 0.9) * 3.5);
      const roll = Math.cos(ny * Math.PI * 7.0) * 2.5;

      // GPS simulation
      const lat = baseLat + (yCm / 100000);
      const lng = baseLng + (xCm / 100000);

      telemetry.push({
        row: r,
        drop: d,
        synX: xCm,
        synY: yCm,
        gpsLat: lat,
        gpsLng: lng,
        moisture,
        watered,
        absHead: parseFloat(absHead.toFixed(1)),
        headErr: parseFloat(headJitter.toFixed(1)),
        pitch: parseFloat(pitch.toFixed(1)),
        roll: parseFloat(roll.toFixed(1)),
        elev: parseFloat(elevation.toFixed(2)),
        sats: 15 + ((d + r) % 4)
      });
    }
  }

  return {
    id: generateId(),
    configId: 'sample-config-rugged-01',
    name,
    startTime: new Date(Date.now() - 3600 * 1000 * 24),
    endTime: new Date(Date.now() - 3600 * 1000 * 23),
    telemetry,
    tags: ['Rugged Terrain', 'Furrows', 'Maize', '3D Tested'],
    notes: 'Demonstration mission over undulating field with pronounced crop ridges, drainage furrows, and uneven soil.'
  };
}
