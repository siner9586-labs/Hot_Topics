import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Cloudflare queue runtime contract', () => {
  it('isolates each regional scoring job without paid-only CPU overrides', async () => {
    const raw = await readFile('workers/pipeline/wrangler.jsonc', 'utf8');
    const config = JSON.parse(raw) as {
      limits?: { cpu_ms?: number };
      queues?: { consumers?: Array<{ max_batch_size?: number; max_batch_timeout?: number; max_retries?: number; max_concurrency?: number }> };
    };
    // The production account currently runs Workers Free; explicit CPU overrides are rejected.
    // Reliability comes from one heavy region per invocation plus CPU-efficient clustering.
    expect(config.limits?.cpu_ms).toBeUndefined();
    const consumer = config.queues?.consumers?.[0];
    expect(consumer?.max_batch_size).toBe(1);
    expect(consumer?.max_batch_timeout).toBe(1);
    expect(consumer?.max_concurrency).toBe(1);
    expect(consumer?.max_retries).toBeGreaterThanOrEqual(5);
  });
});
