/**
 * Utility to load .env file from project root
 * Works from any package directory
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

/**
 * Find project root by looking for .env file
 * Starts from current module location and goes up
 */
function findProjectRoot(startPath: string): string | null {
  let current = resolve(startPath);
  const root = resolve(current, '/');

  while (current !== root) {
    const envPath = join(current, '.env');
    if (existsSync(envPath)) {
      return current;
    }
    current = resolve(current, '..');
  }
  return null;
}

/**
 * Load environment variables from project root .env file
 * This ensures all packages can access the same .env file
 */
export function loadEnvFromRoot(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Find project root (go up from packages/shared/src/utils)
  const projectRoot = findProjectRoot(__dirname);
  
  if (projectRoot) {
    const envPath = join(projectRoot, '.env');
    dotenv.config({ path: envPath });
  } else {
    // Fallback: try current working directory
    dotenv.config();
  }
}

