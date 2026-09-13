import type { TelemetryRow, MissionConfig } from '../types';

export function parseTelemetryCSV(csvContent: string): TelemetryRow[] {
  const lines = csvContent.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  // Find column indices by header name
  const colIndex = {
    row: headers.indexOf('row'),
    drop: headers.indexOf('drop'),
    synX: headers.indexOf('synx') !== -1 ? headers.indexOf('synx') : headers.indexOf('x'),
    synY: headers.indexOf('syny') !== -1 ? headers.indexOf('syny') : headers.indexOf('y'),
    gpsLat: headers.indexOf('lat') !== -1 ? headers.indexOf('lat') : headers.indexOf('gpslat'),
    gpsLng: headers.indexOf('lng') !== -1 ? headers.indexOf('lng') : headers.indexOf('gpslng'),
    moisture: headers.indexOf('moist') !== -1 ? headers.indexOf('moist') : headers.indexOf('moisture'),
    watered: headers.indexOf('watered'),
    absHead: headers.indexOf('abshead') !== -1 ? headers.indexOf('abshead') : headers.indexOf('head') !== -1 ? headers.indexOf('head') : headers.indexOf('heading'),
    headErr: headers.indexOf('err') !== -1 ? headers.indexOf('err') : headers.indexOf('headerr'),
    pitch: headers.indexOf('pitch'),
    roll: headers.indexOf('roll'),
    elev: headers.indexOf('elev') !== -1 ? headers.indexOf('elev') : headers.indexOf('elev_m') !== -1 ? headers.indexOf('elev_m') : headers.indexOf('altitude'),
    press: headers.indexOf('press') !== -1 ? headers.indexOf('press') : headers.indexOf('pressure'),
    sats: headers.indexOf('sats') !== -1 ? headers.indexOf('sats') : headers.indexOf('satellites')
  };

  const rows: TelemetryRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length < 4) continue;

    const getValue = (idx: number, fallback = 0) => {
      if (idx !== -1 && values[idx] !== undefined && values[idx] !== '') {
        const val = parseFloat(values[idx]);
        return isNaN(val) ? fallback : val;
      }
      return fallback;
    };

    const rowVal = colIndex.row !== -1 ? parseInt(values[colIndex.row]) || 1 : parseInt(values[0]) || 1;
    const dropVal = colIndex.drop !== -1 ? parseInt(values[colIndex.drop]) || 1 : parseInt(values[1]) || 1;
    const synX = colIndex.synX !== -1 ? getValue(colIndex.synX, 0) : getValue(2, 0);
    const synY = colIndex.synY !== -1 ? getValue(colIndex.synY, 0) : getValue(3, 0);

    const latRaw = colIndex.gpsLat !== -1 ? values[colIndex.gpsLat] : values[4];
    const lngRaw = colIndex.gpsLng !== -1 ? values[colIndex.gpsLng] : values[5];
    const gpsLat = !latRaw || latRaw === 'NoFix' || isNaN(parseFloat(latRaw)) ? 'NoFix' : parseFloat(latRaw);
    const gpsLng = !lngRaw || lngRaw === 'NoFix' || isNaN(parseFloat(lngRaw)) ? 'NoFix' : parseFloat(lngRaw);

    const moist = colIndex.moisture !== -1 ? parseInt(values[colIndex.moisture]) || 400 : parseInt(values[6]) || 400;
    const wateredVal = colIndex.watered !== -1 ? (parseInt(values[colIndex.watered]) === 1 ? 1 : 0) : (parseInt(values[7]) === 1 ? 1 : 0);

    const absHead = colIndex.absHead !== -1 ? getValue(colIndex.absHead, 0) : getValue(8, 0);
    const headErr = colIndex.headErr !== -1 ? getValue(colIndex.headErr, 0) : getValue(9, 0);
    const pitch = colIndex.pitch !== -1 ? getValue(colIndex.pitch, 0) : getValue(10, 0);
    const roll = colIndex.roll !== -1 ? getValue(colIndex.roll, 0) : getValue(11, 0);
    const sats = colIndex.sats !== -1 ? parseInt(values[colIndex.sats]) || 8 : 8;

    const row: TelemetryRow = {
      row: rowVal,
      drop: dropVal,
      synX,
      synY,
      gpsLat,
      gpsLng,
      moisture: moist,
      watered: wateredVal as 0 | 1,
      absHead,
      headErr,
      pitch,
      roll,
      sats
    };

    // Calculate elevation: check explicit column, then barometric, then dead-reckoning
    if (colIndex.elev !== -1 && values[colIndex.elev] !== undefined && !isNaN(parseFloat(values[colIndex.elev]))) {
      row.elev = parseFloat(parseFloat(values[colIndex.elev]).toFixed(2));
    } else if (colIndex.press !== -1 && values[colIndex.press] !== undefined && !isNaN(parseFloat(values[colIndex.press]))) {
      // Calculate relative altitude from BME280 pressure (hPa)
      const p = parseFloat(values[colIndex.press]);
      const firstLinePress = parseFloat(lines[1].split(',')[colIndex.press]) || 1013.25;
      const deltaH = (firstLinePress - p) * 8.43; // ~8.43m per hPa near sea level
      row.elev = parseFloat((2.5 + deltaH).toFixed(2));
    } else {
      if (rows.length === 0) {
        row.elev = 2.5;
      } else {
        const prev = rows[rows.length - 1];
        const dx = (row.synX - prev.synX) / 100;
        const dy = (row.synY - prev.synY) / 100;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pitchRad = ((row.pitch || 0) * Math.PI) / 180;
        const deltaZ = dist * Math.sin(pitchRad);
        const nextElev = (prev.elev !== undefined ? prev.elev : 2.5) + deltaZ;
        row.elev = parseFloat(nextElev.toFixed(2));
      }
    }

    rows.push(row);
  }

  return rows;
}

export function generateArduinoCode(config: Partial<MissionConfig>): string {
  return `// Mission Configuration
// Generated: ${new Date().toISOString()}

#define TOTAL_ROWS ${config.totalRows || 10}
#define TOTAL_DROPS ${config.totalDrops || 20}
#define DROP_DIST_CM ${config.dropDistCm || 50}
#define ROW_GAP_CM ${config.rowGapCm || 100}
#define BASE_SPEED ${config.baseSpeed || 150}
#define TURN_SPEED ${config.turnSpeed || 100}
#define MAX_CORRECTION ${config.maxCorrection || 50}

// PID Constants
const float Kp = ${config.kp || 2.0};
const float Ki = ${config.ki || 0.1};
const float Kd = ${config.kd || 0.5};

// Moisture threshold (watering trigger)
#define MOISTURE_THRESHOLD ${config.moistureThreshold || 400}
`;
}

export function calculateGridPosition(
  row: number,
  drop: number,
  totalDrops: number,
  dropDistCm: number,
  rowGapCm: number
): { x: number; y: number } {
  const y = (row - 1) * rowGapCm;

  // Boustrophedon pattern
  const x = row % 2 === 1
    ? (drop - 1) * dropDistCm  // Odd rows: increasing
    : (totalDrops - drop) * dropDistCm;  // Even rows: decreasing

  return { x, y };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
