import { platform } from 'node:os';
import { PostHog } from 'posthog-node';
import type { AgentId } from '../types/job.js';
import type { ChannelProvider } from '../types/channel.js';
import { logger } from '../logger.js';
import { resolveSniptailVersion } from '../releaseInfo.js';
import {
  POSTHOG_HOST,
  POSTHOG_PROJECT_API_KEY,
  TELEMETRY_FLUSH_AT,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_REQUEST_TIMEOUT_MS,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SHUTDOWN_TIMEOUT_MS,
} from './posthogTelemetryConfig.js';
import { getTelemetryInstallationId } from './telemetryInstallationId.js';

export type TelemetryRuntimeMode = 'bot' | 'worker' | 'local' | 'cli';
export type TelemetryCommandCategory =
  | 'ask'
  | 'explore'
  | 'plan'
  | 'review'
  | 'implement'
  | 'run'
  | 'mention'
  | 'bootstrap'
  | 'agent_session';
export type TelemetryProviderType = AgentId | 'none';
export type TelemetryStatus = 'success' | 'failure';
export type TelemetryDurationBucket = '<1s' | '1-10s' | '10-60s' | '1-5m' | '5-30m' | '30m+';

export type SniptailTelemetryEvent =
  | {
      name: 'sniptail_runtime_started';
      channelProviders?: ChannelProvider[];
    }
  | {
      name: 'sniptail_command_completed';
      commandCategory: TelemetryCommandCategory;
      providerType: TelemetryProviderType;
      channelProvider?: ChannelProvider;
      status: TelemetryStatus;
      durationBucket: TelemetryDurationBucket;
    };

export interface SniptailTelemetry {
  capture(event: SniptailTelemetryEvent): void;
  shutdown(): Promise<void>;
}

export const NOOP_TELEMETRY: SniptailTelemetry = {
  capture() {},
  async shutdown() {},
};


export function bucketTelemetryDuration(durationMs: number): TelemetryDurationBucket {
  if (durationMs < 1_000) return '<1s';
  if (durationMs < 10_000) return '1-10s';
  if (durationMs < 60_000) return '10-60s';
  if (durationMs < 300_000) return '1-5m';
  if (durationMs < 1_800_000) return '5-30m';
  return '30m+';
}

type CreateTelemetryOptions = {
  enabled: boolean;
  runtimeMode: TelemetryRuntimeMode;
};

export async function createSniptailTelemetry(
  options: CreateTelemetryOptions,
): Promise<SniptailTelemetry> {
  if (!options.enabled) return NOOP_TELEMETRY;

  try {
    const [distinctId, sniptailVersion] = await Promise.all([
      getTelemetryInstallationId(),
      Promise.resolve(resolveSniptailVersion(import.meta.url)),
    ]);
    const client = new PostHog(POSTHOG_PROJECT_API_KEY, {
      host: POSTHOG_HOST,
      flushAt: TELEMETRY_FLUSH_AT,
      flushInterval: TELEMETRY_FLUSH_INTERVAL_MS,
      requestTimeout: TELEMETRY_REQUEST_TIMEOUT_MS,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
    });
    let shutdownPromise: Promise<void> | undefined;

    return {
      capture(event) {
        try {
          const commonProperties = {
            sniptail_version: sniptailVersion,
            runtime_mode: options.runtimeMode,
            platform: platform(),
            telemetry_schema_version: TELEMETRY_SCHEMA_VERSION,
            $process_person_profile: false,
          };
          if (event.name === 'sniptail_runtime_started') {
            client.capture({
              distinctId,
              event: event.name,
              disableGeoip: true,
              properties: {
                ...commonProperties,
                ...(event.channelProviders?.length
                  ? { channel_providers: event.channelProviders }
                  : {}),
              },
            });
            return;
          }
          client.capture({
            distinctId,
            event: event.name,
            disableGeoip: true,
            properties: {
              ...commonProperties,
              command_category: event.commandCategory,
              provider_type: event.providerType,
              ...(event.channelProvider ? { channel_provider: event.channelProvider } : {}),
              status: event.status,
              duration_bucket: event.durationBucket,
            },
          });
        } catch (err) {
          logger.debug({ err }, 'Failed to capture anonymous telemetry event');
        }
      },
      shutdown() {
        shutdownPromise ??= client.shutdown(TELEMETRY_SHUTDOWN_TIMEOUT_MS).catch((err) => {
          logger.debug({ err }, 'Failed to flush anonymous telemetry');
        });
        return shutdownPromise;
      }
    };
  } catch (err) {
    logger.debug({ err }, 'Failed to initialize anonymous telemetry');
    return NOOP_TELEMETRY;
  }
}

