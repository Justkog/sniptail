import 'dotenv/config';
import { logger } from './logger.js';
import { config } from './config/index.js';
import { createQueue } from './queue/index.js';
import { createSlackApp } from './slack/app.js';
import { startWorker } from './worker/index.js';

const queue = createQueue(config.redisUrl);
const app = createSlackApp(queue);

void (async () => {
  await app.start();
  startWorker(app, config.redisUrl, queue);
  logger.info(`⚡️ ${config.botName} is running (Socket Mode)`);
})();
