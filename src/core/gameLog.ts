/**
 * 值班日志：逐局记录结果与表现，跨会话持久化。
 * 纯逻辑 + 可注入存储，浏览器环境用 localStorage，测试用内存存储。
 */
import type { DifficultyId } from './config';
export interface RoundRecord {
  /** 第几局，跨会话持续递增 */
  index: number;
  result: 'won' | 'lost';
  /** 坚持秒数；逃脱成功的局等于时长上限 */
  seconds: number;
  /** 本局发动指令次数 */
  commands: number;
  /** 结算时间戳（ms） */
  at: number;
  /** 本局难度 */
  difficulty?: DifficultyId;
}

export interface LogStore {
  load(): unknown;
  save(value: unknown): void;
}

export const LOG_KEY = 'rounds-log-v1';
/** 只保留最近 30 局，避免 localStorage 无限增长。 */
export const LOG_CAP = 30;

/** localStorage 在隐私模式 / 被禁用时可能抛错，失败则退化为仅本局内存记录。 */
export function createLocalStore(): LogStore | null {
  try {
    const probe = '__rounds_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return {
      load: () => window.localStorage.getItem(LOG_KEY),
      save: value => { window.localStorage.setItem(LOG_KEY, JSON.stringify(value)); },
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is RoundRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.index !== 'number' || !Number.isFinite(record.index) ||
    (record.result !== 'won' && record.result !== 'lost') ||
    typeof record.seconds !== 'number' || !Number.isFinite(record.seconds) ||
    typeof record.commands !== 'number' || !Number.isFinite(record.commands) ||
    typeof record.at !== 'number' || !Number.isFinite(record.at)
  ) return false;
  return record.difficulty === undefined || typeof record.difficulty === 'string';
}

/** 读档容错：损坏的旧数据直接当作没有历史，不让一局游戏挂掉。 */
export function readRecords(store: LogStore | null): RoundRecord[] {
  if (!store) return [];
  try {
    const raw = store.load();
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).slice(-LOG_CAP);
  } catch {
    return [];
  }
}

export function appendRecord(
  records: readonly RoundRecord[],
  result: 'won' | 'lost',
  seconds: number,
  commands: number,
  difficulty: DifficultyId = 'standard',
  at = Date.now(),
): { records: RoundRecord[]; record: RoundRecord } {
  const lastIndex = records.length > 0 ? records[records.length - 1].index : 0;
  const record: RoundRecord = {
    index: lastIndex + 1,
    result,
    seconds: Math.max(0, Math.round(seconds)),
    commands: Math.max(0, Math.round(commands)),
    at,
    difficulty,
  };
  const next = [...records, record];
  return { records: next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next, record };
}

export interface LogSummary {
  played: number;
  won: number;
  bestSeconds: number;
  lastIndex: number;
  lastResult: 'won' | 'lost' | null;
}

export function summarize(records: readonly RoundRecord[]): LogSummary {
  if (records.length === 0) return { played: 0, won: 0, bestSeconds: 0, lastIndex: 0, lastResult: null };
  const last = records[records.length - 1];
  return {
    played: records.length,
    won: records.filter(record => record.result === 'won').length,
    bestSeconds: Math.max(...records.map(record => record.seconds)),
    lastIndex: last.index,
    lastResult: last.result,
  };
}

/** 单行记录文案：结算面板与开始页复用。 */
export function formatRecord(record: RoundRecord): string {
  const outcome = record.result === 'won' ? '逃脱成功' : '被值班员抓住';
  const detail = record.result === 'won' ? `指令 ${record.commands} 次` : `坚持 ${record.seconds} 秒 · 指令 ${record.commands} 次`;
  const tag = record.difficulty ? `${DIFFICULTY_TAG[record.difficulty]} · ` : '';
  return `第 ${record.index} 局 · ${tag}${outcome} · ${detail}`;
}

const DIFFICULTY_TAG: Record<DifficultyId, string> = { intern: '见习', standard: '标准', graveyard: '高危' };

/** 汇总文案：无记录时返回空串，调用方据此隐藏区块。 */
export function formatSummary(records: readonly RoundRecord[]): string {
  const summary = summarize(records);
  if (summary.played === 0) return '';
  return `值班 ${summary.played} 局 · 逃脱 ${summary.won} 次 · 最佳坚持 ${summary.bestSeconds} 秒`;
}
