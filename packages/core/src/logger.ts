import pino, { type LoggerOptions, type TransportSingleOptions } from 'pino';

const options: LoggerOptions = {
  redact: {
    paths: [
      'SLACK_BOT_TOKEN',
      'SLACK_APP_TOKEN',
      'SLACK_SIGNING_SECRET',
      'OPENAI_API_KEY',
      'GITLAB_TOKEN',
    ],
    remove: true,
  },
};

if (process.env.NODE_ENV !== 'production') {
  options.transport = {
    target: 'pino-pretty',
    options: { translateTime: 'SYS:standard' },
  } satisfies TransportSingleOptions;
}

export const logger = pino(options);
