import type { RawHotItem } from '@hot-topics/core';import { rawObservationIdentity } from '@hot-topics/db';import { readFile } from 'node:fs/promises';import { describe,expect,it } from 'vitest';

describe('D1 idempotency contract',()=>{
  it('keeps source identity stable but makes observations run-scoped',()=>{
    const item:RawHotItem={id:'hackernews:story-42',sourceId:'hackernews',sourceType:'forum',region:'GLOBAL',title:'Same story still trending',url:'https://example.com/story/42',rank:1,rawHeat:100,retrievedAt:'2026-08-22T10:00:00.000Z'};
    const first=rawObservationIdentity('run_20260822100000',item);const sameRun=rawObservationIdentity('run_20260822100000',item);const nextRun=rawObservationIdentity('run_20260822130000',{...item,rank:5,rawHeat:80,retrievedAt:'2026-08-22T13:00:00.000Z'});
    expect(first.sourceItemKey).toBe(nextRun.sourceItemKey);expect(first.id).toBe(sameRun.id);expect(first.id).not.toBe(nextRun.id);
  });
  it('schema and writes contain duplicate guards',async()=>{const migration=await readFile('migrations/0001_initial.sql','utf8');const db=await readFile('packages/db/src/index.ts','utf8');expect(migration).toContain('UNIQUE(source_id,source_item_key,run_id)');expect(migration).toContain('UNIQUE(topic_id,region,captured_at)');expect(migration).toContain('UNIQUE(topic_id,source_id,captured_at)');expect(db).toContain('rawObservationIdentity(runId,item)');expect(db).toContain('INSERT OR IGNORE INTO raw_items');expect(db).toContain('INSERT OR REPLACE INTO topic_snapshots');});
});
