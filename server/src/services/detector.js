import EventEmitter from 'node:events';

const CRY_HISTORY_WINDOW = 10;       // 滑动窗口采样数
const CRY_TRIGGER_COUNT = 6;         // 窗口内超过阈值的次数触发哭闹
const CRY_RMS_THRESHOLD = 200;       // RMS 阈值（与固件 SHOW_THRESHOLD=150 对齐偏高）
const QUIET_RMS_THRESHOLD = 80;      // 低于此值视为安静
const QUIET_DURATION_MS = 10_000;    // 安静持续多久切换到 sleeping

const CRY_COOLDOWN_MS = 5_000;       // 哭闹触发后冷却时间
const OFFLINE_TIMEOUT_MS = 15_000;   // 多久没收到数据视为离线

export const STATUS = {
  SLEEPING: 'sleeping',
  AWAKE: 'awake',
  CRYING: 'crying',
  PLAYING: 'playing',
  OFFLINE: 'offline',
};

export class Detector extends EventEmitter {
  constructor() {
    super();
    this.status = STATUS.AWAKE;
    this.rmsHistory = [];
    this.lastDataTime = Date.now();
    this.lastStatusChange = Date.now();
    this.lastCryTime = 0;
    this.offlineTimer = null;
    this._startOfflineWatch();
  }

  /** ESP32 每次上报调用一次 */
  feed(rms, peak) {
    this.lastDataTime = Date.now();
    if (this.status === STATUS.OFFLINE) {
      this._changeStatus(STATUS.AWAKE);
    }

    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > CRY_HISTORY_WINDOW) {
      this.rmsHistory.shift();
    }

    const now = Date.now();

    // -- 哭闹检测 (滑动窗口)
    if (this.status !== STATUS.CRYING) {
      const cryCount = this.rmsHistory.filter(v => v >= CRY_RMS_THRESHOLD).length;
      if (cryCount >= CRY_TRIGGER_COUNT && now - this.lastCryTime > CRY_COOLDOWN_MS) {
        this._changeStatus(STATUS.CRYING);
        this.lastCryTime = now;
      }
    } else {
      // 正在哭闹中：如果最近窗口都很安静，切回 awake
      const quietCount = this.rmsHistory.filter(v => v <= QUIET_RMS_THRESHOLD).length;
      if (quietCount >= CRY_TRIGGER_COUNT) {
        this._changeStatus(STATUS.AWAKE);
      }
    }

    // -- 睡眠检测
    if (this.status === STATUS.AWAKE || this.status === STATUS.PLAYING) {
      if (now - this.lastStatusChange > QUIET_DURATION_MS) {
        const recent = this.rmsHistory.slice(-CRY_HISTORY_WINDOW);
        if (recent.length > 0 && recent.every(v => v <= QUIET_RMS_THRESHOLD)) {
          this._changeStatus(STATUS.SLEEPING);
        }
      }
    } else if (this.status === STATUS.SLEEPING) {
      // 睡中被吵醒
      const loud = this.rmsHistory.filter(v => v >= CRY_RMS_THRESHOLD).length;
      if (loud >= 2) {
        this._changeStatus(STATUS.AWAKE);
      }
    }

    // -- 玩耍检测 (中等音量持续)
    if (this.status === STATUS.AWAKE) {
      if (now - this.lastStatusChange > 30_000) {
        const mid = this.rmsHistory.filter(v => v > QUIET_RMS_THRESHOLD && v < CRY_RMS_THRESHOLD).length;
        if (mid >= 7) {
          this._changeStatus(STATUS.PLAYING);
        }
      }
    } else if (this.status === STATUS.PLAYING) {
      const quiet = this.rmsHistory.filter(v => v <= QUIET_RMS_THRESHOLD).length;
      if (quiet >= 8) {
        this._changeStatus(STATUS.AWAKE);
      }
    }
  }

  _changeStatus(newStatus) {
    if (this.status === newStatus) return;
    const prev = this.status;
    this.status = newStatus;
    this.lastStatusChange = Date.now();
    this.emit('statusChange', { from: prev, to: newStatus, timestamp: this.lastStatusChange });
  }

  _startOfflineWatch() {
    this.offlineTimer = setInterval(() => {
      if (this.status === STATUS.OFFLINE) return;
      if (Date.now() - this.lastDataTime > OFFLINE_TIMEOUT_MS) {
        this._changeStatus(STATUS.OFFLINE);
      }
    }, 2000);
  }

  getDurationSec() {
    return Math.floor((Date.now() - this.lastStatusChange) / 1000);
  }

  destroy() {
    clearInterval(this.offlineTimer);
  }
}
