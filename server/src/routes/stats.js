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
    const all = dataStore.getRecent(9999);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRecords = all.filter(r => r.time >= today.getTime());

    res.json({
      code: 0,
      data: {
        today: {
          cryCount: todayRecords.filter(r => r.status === 'crying').length,
          maxRms: todayRecords.length > 0 ? Math.max(...todayRecords.map(r => r.rms)) : 0,
          avgRms: todayRecords.length > 0
            ? Math.round(todayRecords.reduce((s, r) => s + r.rms, 0) / todayRecords.length)
            : 0,
          sampleCount: todayRecords.length,
        },
        total: {
          cryCount: all.filter(r => r.status === 'crying').length,
          maxRms: all.length > 0 ? Math.max(...all.map(r => r.rms)) : 0,
          sampleCount: all.length,
        },
      },
    });
  });

  return router;
}
