import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';

describe('current ranking snapshot contract',()=>{
  it('serves one coherent latest terminal run instead of per-topic historical maxima',async()=>{
    const source=await readFile('packages/db/src/index.ts','utf8');
    expect(source).toContain("WHERE sr.status IN ('PUBLISHED','PARTIAL')");
    expect(source).toContain("JOIN topic_snapshots s ON s.run_id=lr.run_id AND s.region=?");
    expect(source).not.toContain('WITH latest AS (SELECT topic_id,MAX(captured_at) captured_at');
  });
});
