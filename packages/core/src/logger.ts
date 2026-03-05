import pino, { type Logger, type LoggerOptions, type TransportSingleOptions } from 'pino';

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

options.transport = {
  target: 'pino-pretty',
  options: { translateTime: 'SYS:standard' },
} satisfies TransportSingleOptions;

export const logger = pino(options);

const enabledDebugNamespaces = new Set(
  (process.env.SNIPTAIL_DEBUG ?? '')
    .split(',')
    .map((namespace) => namespace.trim())
    .filter(Boolean),
);

const debugEnabledForAllNamespaces = enabledDebugNamespaces.has('*');

const baseDebugLogger = logger.child({}, { level: 'debug' });
const namespaceDebugLoggerCache = new Map<string, Logger>();
const namespaceDebugFunctionCache = new Map<string, (...args: DebugLogArgs) => void>();

type DebugLogArgs = Parameters<Logger['debug']>;

function getNamespaceDebugLogger(namespace: string): Logger {
  const cachedLogger = namespaceDebugLoggerCache.get(namespace);
  if (cachedLogger) {
    return cachedLogger;
  }

  const namespaceLogger = baseDebugLogger.child({ ns: namespace });
  namespaceDebugLoggerCache.set(namespace, namespaceLogger);
  return namespaceLogger;
}

export function isDebugNamespaceEnabled(namespace: string): boolean {
  return debugEnabledForAllNamespaces || enabledDebugNamespaces.has(namespace);
}

export function debug(namespace: string, ...args: DebugLogArgs): void {
  if (!isDebugNamespaceEnabled(namespace)) {
    return;
  }

  getNamespaceDebugLogger(namespace).debug(...args);
}

export function debugFor(namespace: string): (...args: DebugLogArgs) => void {
  const cachedDebugger = namespaceDebugFunctionCache.get(namespace);
  if (cachedDebugger) {
    return cachedDebugger;
  }

  const namespaceDebugger = (...args: DebugLogArgs): void => {
    debug(namespace, ...args);
  };
  namespaceDebugFunctionCache.set(namespace, namespaceDebugger);
  return namespaceDebugger;
}
