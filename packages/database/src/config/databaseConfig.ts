import path from 'node:path';

export const DATA_DIR_ENV = 'DATA_DIR';
export const DEFAULT_DATA_DIRECTORY = 'data';
export const DEFAULT_DATABASE_FILENAME = 'sparkkeeper.db';

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export interface ResolveDatabasePathOptions {
  readonly cwd?: string;
  readonly databasePath?: string;
  readonly environment?: DatabaseEnvironment;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const explicitPath = readOptionalPath(options.databasePath);

  if (explicitPath !== undefined) {
    return path.resolve(cwd, explicitPath);
  }

  const environment = options.environment ?? process.env;
  const dataDirectory = readOptionalPath(environment[DATA_DIR_ENV]) ?? DEFAULT_DATA_DIRECTORY;

  return path.resolve(cwd, dataDirectory, DEFAULT_DATABASE_FILENAME);
}

function readOptionalPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
