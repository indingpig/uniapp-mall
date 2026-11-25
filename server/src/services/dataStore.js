import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 数据层：SQLite（node:sqlite 内置，Node 22+ 无需装包）
 *
 * 2026-11-25 从内存数组迁移。原实现的硬伤不是性能而是「留存」：
 * MAX_HISTORY=500 条 @500ms ≈ 只有 4.2 分钟，导致统计页按周/月查恒空、
 * 历史页第 2 页起恒空（先 getRecent(pageSize) 再 slice）、重启进程即清空。
 *
 * 数据量实测（按真实使用场景 11h/天）：监听中 500ms 一条 ≈ 4.4 MB/天、
 * 1.6 GB/年——这个量级 SQLite 毫无压力（单库可到 281 TB），
 * 且不需要装服务、不需要连接池，备份=复制一个文件。
 *
 * 设计要点：
 * - **查询即取数**：不缓存全量到内存，每次请求走 SQL + 索引。内存占用恒定。
 * - **按需保留**：原始采样保留 RETENTION_DAYS 天（见下），由 purge() 清理；
 *   日汇总永久保留（一年 365 行）。
 * - **接口不变**：对外方法签名与返回结构沿用内存版，routes/ 与 ws/ 无需改动。
 */

/** 原始采样保留天数。90 天 @4.4MB/天 ≈ 400 MB，对个人云主机足够宽裕 */
const RETENTION_DAYS = 90;

const DB_DIR = path.resolve(import.meta.dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'babycry.db');

// 本地日期键（toISOString 是 UTC，跨午夜后会把日期标偏一天）
const localDateKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

class DataStore {
  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);

    // WAL: 读写不互相阻塞（WS 高频写 + HTTP 并发读的典型场景）
    this.db.exec('PRAGMA journal_mode = WAL');
    // NORMAL: WAL 下的安全/性能平衡点，断电最多丢最后一个事务，对监护采样可接受
    this.db.exec('PRAGMA synchronous = NORMAL');

    this._migrate();
    this._prepare();

    // 上次进程可能没跑完清理，启动时补一次；之后每小时一次
    this.purge();
    this._purgeTimer = setInterval(() => this.purge(), 3_600_000);
    // 不要让定时器阻止进程退出（测试/脚本场景）
    this._purgeTimer.unref?.();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        time   INTEGER NOT NULL,
        rms    INTEGER NOT NULL,
        peak   INTEGER NOT NULL,
        status TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_samples_time ON samples(time);

      CREATE TABLE IF NOT EXISTS events (
        time INTEGER NOT NULL,
        type TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(time);
    `);
  }

  _prepare() {
    // 预编译语句：高频写入路径复用，避免每次解析 SQL
    this._insSample = this.db.prepare(
      'INSERT INTO samples (time, rms, peak, status) VALUES (?, ?, ?, ?)',
    );
    this._insEvent = this.db.prepare('INSERT INTO events (time, type) VALUES (?, ?)');
  }

  /* ------------------------------ 写入 ------------------------------ */

  /** 每次收到 ESP32 数据都记录 */
  addRecord(rms, peak, status) {
    this._insSample.run(Date.now(), rms, peak, status);
  }

  /** 记录事件层事件（「有动静」等） */
  addEvent(type, time = Date.now()) {
    this._insEvent.run(time, type);
  }

  /* ------------------------------ 查询 ------------------------------ */

  /**
   * 获取最近 N 条（返回按时间升序，与原内存版 slice(-n) 语义一致）。
   * 原实现 shift() 丢老数据，这里改为 LIMIT + 倒序取再翻转。
   */
  getRecent(n = 100) {
    const rows = this.db
      .prepare('SELECT time, rms, peak, status FROM samples ORDER BY time DESC LIMIT ?')
      .all(n);
    return rows.reverse();
  }

  /** 按时间范围获取（升序） */
  getRange(from, to) {
    return this.db
      .prepare('SELECT time, rms, peak, status FROM samples WHERE time >= ? AND time <= ? ORDER BY time ASC')
      .all(from, to);
  }

  /**
   * 分页查询（修掉原「第 2 页恒空」bug）。
   * 原实现：先 getRecent(pageSize) 再 slice，total 恒 ≤ pageSize，page≥2 必空。
   * 现用 LIMIT/OFFSET + 独立 COUNT，total 为真实总数。
   */
  getPage({ page = 1, pageSize = 20 } = {}) {
    const total = this.db.prepare('SELECT COUNT(*) AS c FROM samples').get().c;
    const offset = (Math.max(1, page) - 1) * pageSize;
    const items = this.db
      .prepare('SELECT time, rms, peak, status FROM samples ORDER BY time DESC LIMIT ? OFFSET ?')
      .all(pageSize, offset);
    return { items, total };
  }

  /** 按时间范围获取事件层记录 */
  getEvents(from, to) {
    return this.db
      .prepare('SELECT time, type FROM events WHERE time >= ? AND time <= ? ORDER BY time ASC')
      .all(from, to);
  }

  /** 获取当前小时统计 */
  getCurrentHourStats() {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    return this._aggregate(start.getTime(), start.getTime() + 3_600_000);
  }

  /**
   * 逐小时统计（修掉原 hourlyStats 跨天混算 bug）。
   * 原实现只以「小时」为键，进程常开时不同日期的同一小时会累加在一起。
   * 现在按「指定时间范围内、本地时区的小时」聚合，不再跨天串味。
   */
  getAllHourlyStats() {
    // 默认看今天 0 点起的 24 小时；与原 Api 返回结构保持一致（键为 '0'...'23'）
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const rows = this.db
      .prepare(`
        SELECT
          CAST(strftime('%H', time / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
          MAX(rms)                                    AS maxRms,
          ROUND(AVG(rms))                             AS avgRms,
          COUNT(*)                                    AS count,
          SUM(CASE WHEN status = 'crying' THEN 1 ELSE 0 END) AS cryCount
        FROM samples
        WHERE time >= ?
        GROUP BY hour
      `)
      .all(dayStart.getTime());

    const stats = {};
    for (const r of rows) {
      stats[r.hour] = {
        maxRms: r.maxRms,
        avgRms: r.avgRms,
        count: r.count,
        cryCount: r.cryCount,
      };
    }
    return stats;
  }

  /**
   * 按天统计。
   * 原实现遍历内存数组 filter 出每天，且数据不足 500 条时几乎恒空；
   * 现在直接 SQL 分组，且能真正覆盖 days 天。
   */
  getDailyStats(days = 7) {
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setHours(0, 0, 0, 0);
    rangeStart.setDate(rangeStart.getDate() - (days - 1));
    const from = rangeStart.getTime();

    const rows = this.db
      .prepare(`
        SELECT
          strftime('%Y-%m-%d', time / 1000, 'unixepoch', 'localtime') AS date,
          MAX(rms)                                    AS maxRms,
          ROUND(AVG(rms))                             AS avgRms,
          COUNT(*)                                    AS sampleCount,
          SUM(CASE WHEN status = 'crying' THEN 1 ELSE 0 END) AS cryCount
        FROM samples
        WHERE time >= ?
        GROUP BY date
      `)
      .all(from);

    const byDate = new Map(rows.map(r => [r.date, r]));

    // 补齐没有数据的日期（前端按 days 渲染，缺项会导致横轴断裂）
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(rangeStart);
      d.setDate(d.getDate() + i);
      const key = localDateKey(d.getTime());
      const hit = byDate.get(key);
      result.push(
        hit
          ? {
              date: key,
              maxRms: hit.maxRms,
              avgRms: hit.avgRms,
              cryCount: hit.cryCount,
              sampleCount: hit.sampleCount,
            }
          : { date: key, maxRms: 0, avgRms: 0, cryCount: 0, sampleCount: 0 },
      );
    }
    return result;
  }

  _aggregate(from, to) {
    const r = this.db
      .prepare(`
        SELECT MAX(rms) AS maxRms, ROUND(AVG(rms)) AS avgRms, COUNT(*) AS count,
               SUM(CASE WHEN status = 'crying' THEN 1 ELSE 0 END) AS cryCount
        FROM samples WHERE time >= ? AND time < ?
      `)
      .get(from, to);
    if (!r || !r.count) return null;
    return { maxRms: r.maxRms, avgRms: r.avgRms, count: r.count, cryCount: r.cryCount };
  }

  /**
   * 全量摘要（保留期内）。供 /api/stats/summary 的 total 字段使用。
   * 返回结构与前端 StatsSummary.total 对齐：{ cryCount, maxRms, sampleCount }
   */
  getAllTimeSummary() {
    const r = this.db
      .prepare(`
        SELECT COUNT(*) AS sampleCount, MAX(rms) AS maxRms,
               SUM(CASE WHEN status = 'crying' THEN 1 ELSE 0 END) AS cryCount
        FROM samples
      `)
      .get();
    return {
      cryCount: r?.cryCount ?? 0,
      maxRms: r?.maxRms ?? 0,
      sampleCount: r?.sampleCount ?? 0,
    };
  }

  /* ------------------------------ 维护 ------------------------------ */

  /** 清理超过保留期的原始采样。日汇总不在此列（当前未落表，由 getDailyStats 现算） */
  purge() {
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    try {
      this.db.prepare('DELETE FROM samples WHERE time < ?').run(cutoff);
      this.db.prepare('DELETE FROM events WHERE time < ?').run(cutoff);
    }
    catch (e) {
      console.warn('[DataStore] purge 失败:', e?.message ?? e);
    }
  }

  /** 手动关闭（测试用；生产靠进程退出） */
  close() {
    clearInterval(this._purgeTimer);
    this.db.close();
  }
}

export const dataStore = new DataStore();
export { DataStore, RETENTION_DAYS, DB_PATH };
