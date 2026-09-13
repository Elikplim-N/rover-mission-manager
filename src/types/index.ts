export interface MissionConfig {
  id: string;
  name: string;
  fieldId?: string;
  totalRows: number;
  totalDrops: number;
  dropDistCm: number;
  rowGapCm: number;
  baseSpeed: number;
  turnSpeed: number;
  maxCorrection: number;
  kp: number;
  ki: number;
  kd: number;
  moistureThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelemetryRow {
  row: number;
  drop: number;
  synX: number;
  synY: number;
  gpsLat: string | number;
  gpsLng: string | number;
  moisture: number;
  watered: 0 | 1;
  absHead: number;
  headErr: number;
  pitch: number;
  roll: number;
  elev?: number;
  sats: number;
}

export interface MissionRun {
  id: string;
  configId: string;
  name: string;
  fieldId?: string;
  startTime: Date;
  endTime?: Date;
  telemetry: TelemetryRow[];
  tags: string[];
  notes?: string;
}

export interface Field {
  id: string;
  name: string;
  location?: string;
  area?: number;
  notes?: string;
  createdAt: Date;
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  config: Partial<MissionConfig>;
  createdAt: Date;
}
