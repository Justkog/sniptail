export function extractOpenCodeTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('')
    .trim();
}
