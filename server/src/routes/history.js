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
    // 事件层（「有动静」等）随采样记录一并返回，App 时间线把两者按时间归并
    const events = from && to
      ? dataStore.getEvents(Number(from), Number(to))
      : dataStore.getEvents(Date.now() - 6 * 86_400_000, Date.now());

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
        events: events.map(e => ({ time: e.time, type: e.type })),
        total,
        page: Number(page),
        pageSize: Number(pageSize),
      },
    });
  });

  return router;
}
