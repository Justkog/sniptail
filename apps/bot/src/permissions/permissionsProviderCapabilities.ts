import type { ChannelProvider } from '@sniptail/core/types/channel.js';

export type PermissionsProviderCapabilities = {
  liveGroupResolution: boolean;
  approvalButtons: boolean;
  subjectMentions: boolean;
};

const KNOWN_PROVIDER_CAPABILITIES: Record<
  'slack' | 'discord' | 'telegram',
  PermissionsProviderCapabilities
> = {
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
  telegram: {
    liveGroupResolution: false,
    approvalButtons: true,
    subjectMentions: false,
  },
};

export function resolvePermissionsProviderCapabilities(
  provider: ChannelProvider,
): PermissionsProviderCapabilities {
  return (
    KNOWN_PROVIDER_CAPABILITIES[provider as 'slack' | 'discord' | 'telegram'] ?? {
      liveGroupResolution: false,
      approvalButtons: false,
      subjectMentions: false,
    }
  );
}
