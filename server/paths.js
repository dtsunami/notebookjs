import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Two directories with deliberately different lifetimes:
 *
 *   config   ~/.labjs        token, .env        one per machine
 *   data     <cwd>/.labjs    decks, sessions    one per project
 *
 * Credentials are global, runtime state lands next to the files you are working
 * on — the same split `jupyter lab` uses. Importing this module is what loads
 * .env, so it must be the first import of anything that reads the environment;
 * a module that snapshots process.env at import time is otherwise ordered by
 * accident.
 *
 * Overrides:
 *   NB_CONFIG_DIR  moves config only
 *   DATA_DIR       moves *both* (legacy, and what the smoke tests + --data use)
 */

// Project .env first, global second. dotenv never overwrites a key that is
// already set, so the more specific file wins, and a real environment variable
// wins over both.
const localEnv = path.resolve(process.cwd(), '.env');
if (existsSync(localEnv)) dotenv.config({ path: localEnv });

export const CONFIG_DIR = path.resolve(
  process.env.NB_CONFIG_DIR || process.env.DATA_DIR || path.join(homedir(), '.labjs'),
);

export const ENV_FILE = path.join(CONFIG_DIR, '.env');
if (ENV_FILE !== localEnv && existsSync(ENV_FILE)) dotenv.config({ path: ENV_FILE });

export const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(process.cwd(), '.labjs'),
);

export const DECKS_DIR = path.join(DATA_DIR, 'decks');
export const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');