// Nothing to plant: the app is built from scratch in app/.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const work = process.argv[2];
if (existsSync(join(work, 'app'))) throw new Error('brain-chat-app: the workspace already has an app/ folder');
