import fs from 'fs';
import path from 'path';
import { getDefaultDatabasePath } from '../database/context';
import { resolveDataPath } from './data-dir';

export interface AppConfig {
  databasePath: string;
}

const configFilePath = resolveDataPath('config.json', path.join(__dirname, '..', '..', 'config.json'));

const readRawConfig = (): Partial<AppConfig> => {
  try {
    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, 'utf-8');
      return JSON.parse(raw) as Partial<AppConfig>;
    }
  } catch (error) {
    console.error('Error reading config file, falling back to defaults:', error);
  }
  return {};
};

export const getConfig = (): AppConfig => {
  const raw = readRawConfig();
  return {
    databasePath: raw.databasePath?.trim() ? raw.databasePath.trim() : getDefaultDatabasePath(),
  };
};

export const setConfig = (partial: Partial<AppConfig>): AppConfig => {
  const current = getConfig();
  const next: AppConfig = { ...current, ...partial };
  fs.writeFileSync(configFilePath, JSON.stringify(next, null, 2), 'utf-8');
  return next;
};
