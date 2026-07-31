const MAX_HISTORY = 500;

class DataStore {
  constructor() {
    /** 原始数据记录: { time, rms, peak, status }[] */
    this.records = [];

    /** 24 小时按小时聚合统计: { hour: { cryCount, maxRms, avgRms, ... } } */
    this.hourlyStats = {};
  }

  /** 每次收到 ESP32 数据都记录 */
  addRecord(rms, peak, status) {
    const entry = { time: Date.now(), rms, peak, status };
    this.records.push(entry);
    if (this.records.length > MAX_HISTORY) {
      this.records.shift();
    }
    this._updateHourly(entry);
  }

  /** 获取最近 N 条记录 */
  getRecent(n = 100) {
    return this.records.slice(-n);
  }

  /** 按时间范围获取 */
  getRange(from, to) {
    return this.records.filter(r => r.time >= from && r.time <= to);
  }

  /** 获取当前小时统计 */
  getCurrentHourStats() {
    const h = new Date().getHours();
    return this.hourlyStats[h] || null;
  }

  /** 获取所有小时统计 */
  getAllHourlyStats() {
    return { ...this.hourlyStats };
  }

  /** 按天获取统计 */
  getDailyStats(days = 7) {
    const now = Date.now();
    const result = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(now - i * 86_400_000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const dayRecords = this.records.filter(r => r.time >= dayStart.getTime() && r.time < dayEnd.getTime());
      if (dayRecords.length === 0) {
        result.unshift({
          date: dayStart.toISOString().split('T')[0],
          maxRms: 0,
          avgRms: 0,
          cryCount: 0,
          sampleCount: 0,
        });
      } else {
        result.unshift({
          date: dayStart.toISOString().split('T')[0],
          maxRms: Math.max(...dayRecords.map(r => r.rms)),
          avgRms: Math.round(dayRecords.reduce((s, r) => s + r.rms, 0) / dayRecords.length),
          cryCount: dayRecords.filter(r => r.status === 'crying').length,
          sampleCount: dayRecords.length,
        });
      }
    }
    return result;
  }

  _updateHourly(entry) {
    const h = new Date(entry.time).getHours();
    if (!this.hourlyStats[h]) {
      this.hourlyStats[h] = { maxRms: 0, totalRms: 0, count: 0, cryCount: 0 };
    }
    const s = this.hourlyStats[h];
    s.totalRms += entry.rms;
    s.count++;
    s.maxRms = Math.max(s.maxRms, entry.rms);
    if (entry.status === 'crying') s.cryCount++;
    s.avgRms = Math.round(s.totalRms / s.count);
  }
}

export const dataStore = new DataStore();
