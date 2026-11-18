// ===== ntfy 系统级推送兜底 =====
// App 进程被系统杀掉后，App 内的本地通知链路（WS → uni.createPushMessage）全断，
// 这是「手机上收不到哭声提醒」的主因。本模块在 server 端独立于 App 进程存活：
// detector 状态变化时直接把通知投递到 ntfy 主题，家人手机上的 ntfy App
// 订阅同一主题接收（ntfy App 自己维持系统级长连接，本 App 死活都不影响它收）。
//
// 配置全部来自本地 .env：主题名在公共 ntfy.sh 上等同密码（谁订阅谁就能收），
// 与 token 同属敏感信息，严禁提交真实值（见 .env.example 与 AGENTS.md）。

const NTFY_ENABLED = process.env.NTFY_ENABLED === 'true';
const NTFY_URL = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_TOKEN = process.env.NTFY_TOKEN || '';
const NTFY_PRIORITY = process.env.NTFY_PRIORITY || 'high';

/** 节流窗口：状态 noise→cry 反复抖动时，60s 内不重复推送（与 App 侧通知节流对齐） */
const CRY_THROTTLE_MS = Number(process.env.NTFY_CRY_THROTTLE_MS) || 60_000;

/**
 * 失联确认窗口：detector 15s 无数据即转 offline，但 WiFi 瞬断很常见，
 * 持续仍离线才推送，避免瞬断误报打扰（监护系统误报同样消耗信任）。
 */
const OFFLINE_CONFIRM_MS = Number(process.env.NTFY_OFFLINE_CONFIRM_MS) || 60_000;

let lastPushAt = 0;
let offlineConfirmTimer = null;
let offlinePushed = false;

/** 统一投递口。不 await——推送成败与 WS 广播无关，不能拖慢事件层；
 * 失败只记日志（不回显 topic/token，避免日志泄敏）。 */
function sendNtfy({ title, message, tags, priority }) {
  fetch(`${NTFY_URL}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(NTFY_TOKEN ? { Authorization: `Bearer ${NTFY_TOKEN}` } : {}),
    },
    body: JSON.stringify({ topic: NTFY_TOPIC, title, message, tags, priority }),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (res.ok) {
        console.log(`[Notify] ntfy push sent: ${title}`);
      } else {
        console.error('[Notify] ntfy push failed: HTTP', res.status);
      }
    })
    .catch((err) => {
      console.error('[Notify] ntfy push error:', err.message);
    });
}

const enabled = () => NTFY_ENABLED && NTFY_TOPIC;

/**
 * 哭声兜底推送，detector 进入 crying 的瞬间调用（handler.js statusChange 挂点）。
 * 未启用/未配置主题时静默跳过。
 */
export function pushCry() {
  if (!enabled()) return;
  const now = Date.now();
  if (now - lastPushAt < CRY_THROTTLE_MS) return;
  lastPushAt = now;

  sendNtfy({
    title: '宝宝哭了',
    message: '检测到哭声，快去看看宝宝',
    tags: ['baby', 'rotating_light'],
    priority: NTFY_PRIORITY,
  });
}

/**
 * 设备转 offline（handler.js 挂点）。开一个确认窗口：窗口结束时仍离线才推送，
 * 期间恢复则静默取消（瞬断不打扰）。isStillOffline 由调用方闭包提供，
 * 挂点处无需感知 detector 内部状态。
 */
export function deviceWentOffline(isStillOffline) {
  if (!enabled()) return;
  if (offlineConfirmTimer) return;
  offlineConfirmTimer = setTimeout(() => {
    offlineConfirmTimer = null;
    if (!isStillOffline()) return;
    offlinePushed = true;
    sendNtfy({
      title: '监护器失联',
      message: '设备已离线超过一分钟，请检查设备电源与网络',
      tags: ['baby', 'warning'],
      priority: NTFY_PRIORITY,
    });
  }, OFFLINE_CONFIRM_MS);
}

/** 设备恢复上线：取消未确认的看门狗；仅当离线推送真发过才发恢复通知（短瞬断不发） */
export function deviceCameBack() {
  if (offlineConfirmTimer) {
    clearTimeout(offlineConfirmTimer);
    offlineConfirmTimer = null;
  }
  if (!offlinePushed) return;
  offlinePushed = false;
  sendNtfy({
    title: '监护已恢复',
    message: '设备重新上线，恢复监护',
    tags: ['baby', 'white_check_mark'],
    priority: 'default',
  });
}

/** 启动时提示兜底推送配置状态（只报开关与主题是否配置，不回显真实值） */
export function logNotifyConfig() {
  if (!NTFY_ENABLED) return;
  console.log(
    NTFY_TOPIC
      ? `[Notify] ntfy fallback push enabled (${NTFY_URL})`
      : '[Notify] NTFY_ENABLED=true 但未配置 NTFY_TOPIC，兜底推送未生效',
  );
}
