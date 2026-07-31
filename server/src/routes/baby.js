import { Router } from 'express';

export function createBabyRoutes(detector, dataStore) {
  const router = Router();

  const STATUS_META = {
    sleeping: { text: '正在睡觉', iconKey: 'face-cry', iconColor: '#7ea279' },
    awake: { text: '醒着', iconKey: 'face-cry', iconColor: '#d8896a' },
    crying: { text: '正在哭泣', iconKey: 'face-cry', iconColor: '#e25c3c' },
    playing: { text: '正在玩耍', iconKey: 'face-cry', iconColor: '#5b9bd5' },
    offline: { text: '设备离线', iconKey: 'face-cry', iconColor: '#999999' },
  };

  /** 获取当前宝宝状态 */
  router.get('/status', (_req, res) => {
    const meta = STATUS_META[detector.status] || STATUS_META.offline;
    res.json({
      code: 0,
      data: {
        status: detector.status,
        statusText: meta.text,
        iconKey: meta.iconKey,
        iconColor: meta.iconColor,
        durationSec: detector.getDurationSec(),
        isOnline: detector.status !== 'offline',
      },
    });
  });

  /** 获取当前音量 */
  router.get('/volume', (_req, res) => {
    const recent = dataStore.getRecent(1);
    const record = recent[0];
    res.json({
      code: 0,
      data: {
        rms: record?.rms ?? 0,
        peak: record?.peak ?? 0,
        db: record ? Math.round(20 * Math.log10(Math.max(record.rms, 1))) : 0,
        timestamp: record?.time ?? Date.now(),
      },
    });
  });

  /** 获取设备信息 */
  router.get('/device', (_req, res) => {
    const isOnline = detector.status !== 'offline';
    res.json({
      code: 0,
      data: {
        name: 'ESP32 婴儿监护器',
        connectionText: isOnline ? '已连接 · 正常' : '未连接',
        batteryPercent: 85,
        signalStrength: 4,
        isOnline,
      },
    });
  });

  return router;
}
