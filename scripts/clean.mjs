// Removes the build output (cross-platform `rm -rf dist`).
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
