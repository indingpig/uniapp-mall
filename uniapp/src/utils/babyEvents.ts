/**
 * 历史记录 → 状态事件推导（历史页 / 统计页共用）
 *
 * 后端 /api/history 返回的是采样记录（约 500ms 一条，倒序），
 * 相邻记录 status 变化即为一次状态切换事件；
 * 连续同状态区间的时长可用于"安睡时长/哭闹持续"等派生指标。
 */
import type { HistoryRecord } from '@/api/baby';

export interface StatusEvent {
  time: number;
  from: string;
  to: string;
  /** 本次状态持续时长 ms（到下一条记录或区间末端） */
  durationMs: number;
}

export interface DerivedTimeline {
  events: StatusEvent[];
  /** 区间内累计安睡时长 ms */
  sleepMs: number;
  /** 区间内哭闹事件次数（进入 crying 的切换） */
  cryCount: number;
  /** 按天安睡时长（key = YYYY-MM-DD），统计页点选某天时用 */
  sleepMsByDay: Record<string, number>;
}

/**
 * @param records 倒序采样记录（新→旧），需覆盖完整区间
 * @param rangeEndMs 区间末端时间戳（用于最后一段时长封口）
 */
export function deriveTimeline(records: HistoryRecord[], rangeEndMs: number): DerivedTimeline {
  // 转为旧→新便于顺序推导
  const asc = [...records].reverse();
  const events: StatusEvent[] = [];
  let sleepMs = 0;
  let cryCount = 0;
  const sleepMsByDay: Record<string, number> = {};

  let activeEvent: StatusEvent | null = null;
  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i];
    const next = asc[i + 1];
    const end = next ? next.time : rangeEndMs;
    const durationMs = Math.max(0, end - cur.time);
    if (cur.status === 'sleeping') {
      sleepMs += durationMs;
      const dayKey = fmtDateKey(cur.time);
      sleepMsByDay[dayKey] = (sleepMsByDay[dayKey] ?? 0) + durationMs;
    }
    const prev = asc[i - 1];
    if (!prev || prev.status !== cur.status) {
      if (cur.status === 'crying')
        cryCount++;
      activeEvent = { time: cur.time, from: prev?.status ?? '', to: cur.status, durationMs: 0 };
      events.push(activeEvent);
    }
    // 该段时长归属当前所处状态的事件（此前错误地全部累加到最后一个事件）
    if (activeEvent)
      activeEvent.durationMs += durationMs;
  }

  return { events, sleepMs, cryCount, sleepMsByDay };
}

/** 时间戳 → 本地日期键 YYYY-MM-DD（勿用 toISOString：UTC 会在跨午夜后偏移一天） */
export function fmtDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ms → "8h 32m" / "2m 40s" */
export function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((ms % 60_000) / 1000);
  if (h > 0)
    return `${h}h ${m}m`;
  if (m > 0)
    return `${m}m ${s}s`;
  return `${s}s`;
}

/** 采样记录 → 状态占比（按条数近似时长，附录说明见统计页脚注） */
export function statusDistribution(records: HistoryRecord[]): { status: string; ratio: number }[] {
  const count: Record<string, number> = {};
  for (const r of records) count[r.status] = (count[r.status] ?? 0) + 1;
  const total = records.length || 1;
  return Object.entries(count)
    .map(([status, n]) => ({ status, ratio: n / total }))
    .sort((a, b) => b.ratio - a.ratio);
}
