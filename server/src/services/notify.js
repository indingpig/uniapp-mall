// ===== ntfy 系统级推送兜底 =====
// App 进程被系统杀掉后，App 内的本地通知链路（WS → uni.createPushMessage）全断，
// 这是「手机上收不到哭声提醒」的主因。本模块在 server 端独立于 App 进程存活：
// detector 进入 crying 时直接把通知投递到 ntfy 主题，家人手机上的 ntfy App
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

let lastPushAt = 0;

/**
 * 哭声兜底推送，detector 进入 crying 的瞬间调用（handler.js statusChange 挂点）。
 * 未启用/未配置主题时静默跳过；不 await——推送成败与 WS 广播无关，不能拖慢事件层；
 * 失败只记日志（不回显 topic/token，避免日志泄敏）。
 */
export function pushCry() {
  if (!NTFY_ENABLED || !NTFY_TOPIC) return;
  const now = Date.now();
  if (now - lastPushAt < CRY_THROTTLE_MS) return;
  lastPushAt = now;

  fetch(`${NTFY_URL}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(NTFY_TOKEN ? { Authorization: `Bearer ${NTFY_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: '宝宝哭了',
      message: '检测到哭声，快去看看宝宝',
      tags: ['baby', 'rotating_light'],
      priority: NTFY_PRIORITY,
    }),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (res.ok) {
        console.log('[Notify] ntfy cry push sent');
      } else {
        console.error('[Notify] ntfy push failed: HTTP', res.status);
      }
    })
    .catch((err) => {
      console.error('[Notify] ntfy push error:', err.message);
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
