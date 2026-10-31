import { describe, expect, it } from 'vitest';
import { appendRecord, formatRecord, formatSummary, readRecords, summarize, type RoundRecord } from '../src/core/gameLog';

const record = (index: number, result: 'won' | 'lost', seconds: number): RoundRecord =>
  ({ index, result, seconds, commands: 1, at: 1000 + index });

describe('值班日志', () => {
  it('追加记录：局号递增、字段规整、保留在容量内', () => {
    const first = appendRecord([], 'lost', 21.4, 2);
    expect(first.record).toMatchObject({ index: 1, result: 'lost', seconds: 21, commands: 2 });
    const second = appendRecord(first.records, 'won', 45, 0);
    expect(second.record.index).toBe(2);
    expect(second.records).toHaveLength(2);
    let records = first.records;
    for (let i = 0; i < 40; i++) records = appendRecord(records, 'lost', 5, 0).records;
    expect(records.length).toBeLessThanOrEqual(30);
    expect(records[records.length - 1].index).toBe(41);
    expect(records[0].index).toBe(12);
  });

  it('读档容错：损坏数据、非数组、缺字段一律当作无历史', () => {
    expect(readRecords(null)).toEqual([]);
    expect(readRecords({ load: () => null, save: () => {} })).toEqual([]);
    expect(readRecords({ load: () => 'not json{', save: () => {} })).toEqual([]);
    expect(readRecords({ load: () => '{"a":1}', save: () => {} })).toEqual([]);
    const mixed = JSON.stringify([record(1, 'won', 45), { index: 2 }, record(3, 'lost', 10)]);
    expect(readRecords({ load: () => mixed, save: () => {} })).toHaveLength(2);
  });

  it('汇总与文案：空历史隐藏，有历史给出一行摘要', () => {
    expect(formatSummary([])).toBe('');
    const records = [record(1, 'lost', 12), record(2, 'won', 45), record(3, 'lost', 33)];
    const summary = summarize(records);
    expect(summary).toMatchObject({ played: 3, won: 1, bestSeconds: 45, lastIndex: 3, lastResult: 'lost' });
    expect(formatRecord(records[1])).toBe('第 2 局 · 逃脱成功 · 指令 1 次');
    expect(formatRecord(records[2])).toBe('第 3 局 · 被值班员抓住 · 坚持 33 秒 · 指令 1 次');
    expect(formatSummary(records)).toBe('值班 3 局 · 逃脱 1 次 · 最佳坚持 45 秒');
  });
});
