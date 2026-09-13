import Dexie from 'dexie';
import type { MissionConfig, MissionRun, Field, Template } from '../types';

export class RoverDatabase extends Dexie {
  configs!: Dexie.Table<MissionConfig>;
  runs!: Dexie.Table<MissionRun>;
  fields!: Dexie.Table<Field>;
  templates!: Dexie.Table<Template>;

  constructor() {
    super('RoverMissionDB');

    this.version(1).stores({
      configs: 'id, name, fieldId, createdAt, updatedAt',
      runs: 'id, configId, fieldId, name, startTime, tags',
      fields: 'id, name, createdAt',
      templates: 'id, name, createdAt'
    });
  }
}

export const db = new RoverDatabase();
