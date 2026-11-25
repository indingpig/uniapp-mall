import { Router } from 'express';
import { dataStore } from '../services/dataStore.js';

export function createStatsRoutes() {
  const router = Router();

  /** 获取每日统计 */
  router.get('/daily', (req, res) => {
    const days = Number(req.query.days) || 7;
    res.json({
      code: 0,
      data: dataStore.getDailyStats(days),
    });
  });

  /** 获取每小时统计 */
  router.get('/hourly', (_req, res) => {
    const stats = dataStore.getAllHourlyStats();
    const result = [];
    for (let h = 0; h < 24; h++) {
      const s = stats[h] || { maxRms: 0, avgRms: 0, count: 0, cryCount: 0 };
      result.push({ hour: h, ...s });
    }
    res.json({
      code: 0,
      data: result,
    });
  });

  /** 摘要统计 */
  router.get('/summary', (_req, res) => {
    // 2026-11-25：改用 SQL 聚合，不再 getRecent(9999) 捞全量。
    // 原实现受 MAX_HISTORY=500 限制，"今日"统计实际只看最近 4 分钟；
    // 迁 SQLite 后若继续 getRecent(9999) 会漏掉 9999 条之外的今日数据。
    const today = dataStore.getDailyStats(1)[0] || {
      cryCount: 0,
      maxRms: 0,
      avgRms: 0,
      sampleCount: 0,
    };
    // total 保持原结构（cryCount/maxRms/sampleCount）不变，避免破坏前端类型契约；
    // 语义 = 库内保留期内的全部采样。注意前端已注明它「不能当昨日基线」。
    const total = dataStore.getAllTimeSummary();

    res.json({
      code: 0,
      data: {
        today: {
          cryCount: today.cryCount,
          maxRms: today.maxRms,
          avgRms: today.avgRms,
          sampleCount: today.sampleCount,
        },
        total,
      },
    });
  });

  return router;
}
