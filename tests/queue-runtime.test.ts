import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Cloudflare queue runtime contract', () => {
  it('gives each regional scoring job its own consumer invocation and CPU budget', async () => {
    const raw = await readFile('workers/pipeline/wrangler.jsonc', 'utf8');
    const config = JSON.parse(raw) as {
      limits?: { cpu_ms?: number };
      queues?: { consumers?: Array<{ max_batch_size?: number; max_batch_timeout?: number; max_retries?: number; max_concurrency?: number }> };
    };
    expect(config.limits?.cpu_ms).toBe(300_000);
    const consumer = config.queues?.consumers?.[0];
    expect(consumer?.max_batch_size).toBe(1);
    expect(consumer?.max_batch_timeout).toBe(1);
    expect(consumer?.max_concurrency).toBe(1);
    expect(consumer?.max_retries).toBeGreaterThanOrEqual(5);
  });
});
