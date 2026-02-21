export function resolveDiscordActorGroups(input: {
  roleIds: string[];
  candidateGroupIds: string[];
}): string[] {
  if (!input.roleIds.length || !input.candidateGroupIds.length) {
    return [];
  }
  const roles = new Set(input.roleIds);
  return input.candidateGroupIds.filter((groupId) => roles.has(groupId));
}
