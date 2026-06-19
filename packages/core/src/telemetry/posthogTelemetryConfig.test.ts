import { describe, expect, it } from 'vitest';
import { POSTHOG_HOST, POSTHOG_PROJECT_API_KEY } from './posthogTelemetryConfig.js';

describe('PostHog telemetry configuration', () => {
  it('uses an HTTPS ingestion host and a public project key slot', () => {
    expect(new URL(POSTHOG_HOST).protocol).toBe('https:');
    expect(POSTHOG_PROJECT_API_KEY).toMatch(/^phc_/);
  });
});
