export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'“”"`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return ascii || `topic-${stableHash(input)}`;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function hoursBetween(laterIso: string, earlierIso: string): number {
  return Math.max(0, (Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000);
}

export function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function isLikelyChallengePage(text: string): boolean {
  const sample = text.slice(0, 20_000).toLowerCase();
  const markers = [
    'captcha', 'verify you are human', 'robot check', 'access denied', '请完成验证',
    '安全验证', '登录后继续', 'cloudflare ray id', 'unusual traffic'
  ];
  return markers.some((marker) => sample.includes(marker));
}

export function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
}

export function stripTags(input: string): string {
  return decodeXmlEntities(input.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface StructuredLog {
  run_id?: string;
  source?: string;
  stage: string;
  status: string;
  duration_ms?: number;
  detail?: string;
  [key: string]: unknown;
}

export function createLogger(sink: (line: string) => void = (line) => globalThis.console.info(line)) {
  return (entry: StructuredLog): void => sink(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<Response> {
  const controller = new AbortController();
  const external = init.signal;
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}
