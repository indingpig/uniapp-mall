import { Router } from 'express';

export function createHistoryRoutes(dataStore) {
  const router = Router();

  /** 获取历史记录列表 */
  router.get('/', (req, res) => {
    const { page = 1, pageSize = 20, from, to } = req.query;

    let records;
    if (from && to) {
      records = dataStore.getRange(Number(from), Number(to));
    } else {
      records = dataStore.getRecent(Number(pageSize));
    }

    const total = records.length;
    const start = (Number(page) - 1) * Number(pageSize);
    const items = records.slice(start, start + Number(pageSize)).reverse();

    res.json({
      code: 0,
      data: {
        items: items.map(r => ({
          time: r.time,
          rms: r.rms,
          peak: r.peak,
          db: Math.round(20 * Math.log10(Math.max(r.rms, 1))),
          status: r.status,
        })),
        total,
        page: Number(page),
        pageSize: Number(pageSize),
      },
    });
  });

  return router;
}
