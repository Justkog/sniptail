import type { ChannelProvider } from '@sniptail/core/types/channel.js';

export type PermissionsProviderCapabilities = {
  liveGroupResolution: boolean;
  approvalButtons: boolean;
  subjectMentions: boolean;
};

const KNOWN_PROVIDER_CAPABILITIES: Record<'slack' | 'discord', PermissionsProviderCapabilities> = {
  slack: {
    liveGroupResolution: true,
    approvalButtons: true,
    subjectMentions: true,
  },
  discord: {
    liveGroupResolution: true,
    approvalButtons: true,
    subjectMentions: true,
  },
};

export function resolvePermissionsProviderCapabilities(
  provider: ChannelProvider,
): PermissionsProviderCapabilities {
  return (
    KNOWN_PROVIDER_CAPABILITIES[provider as 'slack' | 'discord'] ?? {
      liveGroupResolution: false,
      approvalButtons: false,
      subjectMentions: false,
    }
  );
}
