import fs from 'fs';
import path from 'path';

/**
 * Optional writable data directory (e.g. set by the desktop shell to the user's
 * profile folder). When unset, files keep their historical locations next to
 * the backend, so the standalone/enterprise deployment behaves as before.
 */
export const getDataDir = (): string | undefined => {
  const dir = process.env.THOTH_DATA_DIR?.trim();
  if (!dir) {
    return undefined;
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Resolves `name` inside THOTH_DATA_DIR when set, otherwise returns `fallback`. */
export const resolveDataPath = (name: string, fallback: string): string => {
  const dir = getDataDir();
  return dir ? path.join(dir, name) : fallback;
};
