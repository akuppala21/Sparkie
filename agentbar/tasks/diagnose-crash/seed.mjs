// Puts the saved incident (container log, setup, nvidia-smi) in the workspace's incident/ folder.
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const work = process.argv[2];
cpSync(fileURLToPath(new URL('./incident', import.meta.url)), join(work, 'incident'), { recursive: true });
