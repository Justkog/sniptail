import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();
const shutdown = vi.fn(() => Promise.resolve());
const originalSniptailVersion = process.env.SNIPTAIL_VERSION;

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function MockPostHog() {
    return {
      capture,
      _shutdown: shutdown,
    };
  }),
}));

vi.mock('./posthogTelemetryConfig.js', () => ({
  POSTHOG_PROJECT_API_KEY: 'phc_test_project_key',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  TELEMETRY_SCHEMA_VERSION: 1,
  TELEMETRY_FLUSH_AT: 10,
  TELEMETRY_FLUSH_INTERVAL_MS: 10_000,
  TELEMETRY_REQUEST_TIMEOUT_MS: 2_000,
  TELEMETRY_SHUTDOWN_TIMEOUT_MS: 2_000,
  hasConfiguredPostHogProjectKey: () => true,
}));

vi.mock('./telemetryInstallationId.js', () => ({
  getTelemetryInstallationId: () => Promise.resolve('11111111-1111-4111-8111-111111111111'),
}));

import { bucketTelemetryDuration, createSniptailTelemetry } from './sniptailTelemetry.js';

beforeEach(() => {
  capture.mockClear();
  shutdown.mockClear();
});

afterEach(() => {
  if (originalSniptailVersion === undefined) {
    delete process.env.SNIPTAIL_VERSION;
  } else {
    process.env.SNIPTAIL_VERSION = originalSniptailVersion;
  }
});

describe('Sniptail telemetry', () => {
  it('captures only the typed command properties and privacy controls', async () => {
    const telemetry = await createSniptailTelemetry({
      enabled: true,
      runtimeMode: 'worker',
    });

    telemetry.capture({
      name: 'sniptail_command_completed',
      commandCategory: 'ask',
      providerType: 'codex',
      channelProvider: 'discord',
      status: 'success',
      durationBucket: '1-10s',
    });

    expect(capture).toHaveBeenCalledTimes(1);
    const call = capture.mock.calls[0]?.[0] as {
      distinctId: string;
      event: string;
      disableGeoip: boolean;
      properties: Record<string, unknown>;
    };
    expect(call.distinctId).toBe('11111111-1111-4111-8111-111111111111');
    expect(call.event).toBe('sniptail_command_completed');
    expect(call.disableGeoip).toBe(true);
    expect(call.properties).toEqual({
      sniptail_version: '0.3.0',
      runtime_mode: 'worker',
      platform: process.platform,
      telemetry_schema_version: 1,
      $process_person_profile: false,
      command_category: 'ask',
      provider_type: 'codex',
      channel_provider: 'discord',
      status: 'success',
      duration_bucket: '1-10s',
    });
  });

  it('uses the environment version override', async () => {
    process.env.SNIPTAIL_VERSION = '9.8.7';
    const telemetry = await createSniptailTelemetry({
      enabled: true,
      runtimeMode: 'worker',
    });

    telemetry.capture({ name: 'sniptail_runtime_started' });

    const call = capture.mock.calls[0]?.[0] as {
      properties: Record<string, unknown>;
    };
    expect(call.properties.sniptail_version).toBe('9.8.7');
  });

  it('does no work when disabled', async () => {
    const telemetry = await createSniptailTelemetry({
      enabled: false,
      runtimeMode: 'cli',
    });

    telemetry.capture({ name: 'sniptail_runtime_started' });
    await telemetry.shutdown();

    expect(capture).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('shuts down only once', async () => {
    const telemetry = await createSniptailTelemetry({
      enabled: true,
      runtimeMode: 'bot',
    });

    await Promise.all([telemetry.shutdown(), telemetry.shutdown()]);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith(2_000);
  });

  it.each([
    [0, '<1s'],
    [999, '<1s'],
    [1_000, '1-10s'],
    [10_000, '10-60s'],
    [60_000, '1-5m'],
    [300_000, '5-30m'],
    [1_800_000, '30m+'],
  ] as const)('buckets %i ms as %s', (durationMs, expected) => {
    expect(bucketTelemetryDuration(durationMs)).toBe(expected);
  });
});
