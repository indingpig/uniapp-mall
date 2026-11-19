import { onBackPress } from '@dcloudio/uni-app';
import { isKeepAliveEnabled, moveTaskToBack } from '@/utils/keepalive';

/**
 * tab 页返回键拦截：后台保活开启时，硬件返回键 = 退到后台而非退出 App。
 *
 * 为什么必须四个 tab 页都挂（2026-11-19 补齐 history/stats/settings）：
 * 默认返回会 finish 主 Activity → webview/JS 随之死亡 → 前台服务还在、常驻通知
 * 还在，但 WebSocket 已断、哭声本地通知永远不会发（「幽灵通知」）。首页原本单独
 * 实现过一份，其余三个 tab 页漏了，用户在任意其它 tab 按返回就退出了监护。
 *
 * 保活关闭时不拦截，行为与从前一致（由 ntfy 兜底推送接管）。
 * 非 tab 页（配对/详情等）不挂：那里的返回是页面栈语义，不应劫持。
 */
export function useBackToBackground() {
  onBackPress((options) => {
    // 仅 Android 硬件/手势返回键；navigateBack 等语义不劫持
    if (options.from !== 'backbutton' || !isKeepAliveEnabled())
      return false;
    return moveTaskToBack();
  });
}
