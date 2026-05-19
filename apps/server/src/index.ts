import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDeskCallServer } from './createServer.js';

loadDotenv();
loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

const config = loadConfig();
const { httpServer } = createDeskCallServer(config);

httpServer.listen(config.PORT, () => {
  console.info(`[server] DeskCall signaling server listening on port ${config.PORT}`);
  console.info(`[server] CORS origin: ${config.CORS_ORIGIN}`);
  console.info(`[server] Auth mode: ${config.AUTH_MODE}`);
});
