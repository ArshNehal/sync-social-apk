// Lightweight cleanup helpers for legacy post/chat formatting tokens

const SPLIT_TOKEN = '[sync:split]';
const WHISPER_PREFIX = '[sync:whisper]';
const PULSE_PREFIX = '[sync:pulse]';

export function parsePostContent(raw: string): { cleanText: string } {
  if (!raw) return { cleanText: '' };
  const cleanText = raw.replace(/\n*\[sync:split\]\s*/g, '').trim();
  return { cleanText };
}

export function cleanChatMessageText(raw: string): string {
  const trimmed = (raw || '').trim();
  if (trimmed === PULSE_PREFIX || trimmed.startsWith(`${PULSE_PREFIX} `)) {
    const rest = trimmed.slice(PULSE_PREFIX.length).trim();
    return rest || 'Pulse';
  }
  if (trimmed.startsWith(WHISPER_PREFIX)) {
    return trimmed.slice(WHISPER_PREFIX.length).trim();
  }
  if (trimmed.includes(SPLIT_TOKEN)) {
    return trimmed.replace(/\n*\[sync:split\]\s*/g, '').trim();
  }
  return raw || '';
}

export function formatChatPreview(raw?: string): string {
  if (!raw) return 'No messages yet';
  return cleanChatMessageText(raw) || 'Sent an attachment';
}
