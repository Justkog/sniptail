export function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength).trimEnd();
}

export function wrapText(value: string, width: number): string {
  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
  if (!normalized) return '';

  const paragraphs = normalized.split(/\n{2,}/);
  return paragraphs
    .map((paragraph) => {
      const words = paragraph.replace(/\s+/g, ' ').trim().split(' ');
      if (!words[0]) return '';
      const lines: string[] = [];
      let current = words[0];
      for (const word of words.slice(1)) {
        if (`${current} ${word}`.length > width) {
          lines.push(current);
          current = word;
        } else {
          current = `${current} ${word}`;
        }
      }
      lines.push(current);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

export function firstContentLine(text: string): string {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, '');
  }
  return '';
}
