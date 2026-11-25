import { Router } from 'express';

export function createHistoryRoutes(dataStore) {
  const router = Router();

  /** 获取历史记录列表 */
  router.get('/', (req, res) => {
    const { page = 1, pageSize = 20, from, to } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Number(pageSize) || 20);

    let items;
    let total;
    if (from && to) {
      // 指定时间范围：范围内全量取回后分页（范围通常有限，安全）
      const records = dataStore.getRange(Number(from), Number(to));
      total = records.length;
      const start = (pageNum - 1) * size;
      // 与原实现一致：对外按时间倒序
      items = records.slice(start, start + size).reverse();
    } else {
      // 无范围：走数据库分页。
      // 2026-11-25 修 bug——原实现先 getRecent(pageSize) 再 slice，
      // total 恒 ≤ pageSize，page≥2 必返回空数组。
      const paged = dataStore.getPage({ page: pageNum, pageSize: size });
      total = paged.total;
      // getPage 已是倒序（新→旧），这里保持对外语义不变
      items = paged.items;
    }

    // 事件层（「有动静」等）随采样记录一并返回，App 时间线把两者按时间归并
    const events = from && to
      ? dataStore.getEvents(Number(from), Number(to))
      : dataStore.getEvents(Date.now() - 6 * 86_400_000, Date.now());

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
        page: pageNum,
        pageSize: size,
      },
    });
  });

  return router;
}
