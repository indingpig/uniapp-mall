import { onShow } from '@dcloudio/uni-app';
import { CACHE_KEY } from '@/constants/cache';
import { isIgnoringBatteryOptimizations, isKeepAliveAvailable, isKeepAliveEnabled, requestIgnoreBatteryOptimizations } from '@/utils/keepalive';
import { hasLocalPairing } from '@/utils/storage';

/**
 * 电池优化白名单的首次自动引导（只打扰一次）。
 *
 * 为什么需要在设置页之外再做一个自动弹窗：白名单是这套保活方案真正的生死线——
 * 未豁免时系统会在 Doze 下忽略 WakeLock 并限制网络，锁屏久了后台 WebSocket
 * 基本注定半死。而设置页那一行要用户自己翻进去点，实际几乎没人会去。
 *
 * 触发条件（全部满足才弹）：Android 端 + 已配对 + 后台保活开着 + 未豁免 +
 * 本次安装还没提示过。用户点「暂不」也记为已提示——监护 App 反复弹系统级授权
 * 会很烦，需要时随时可从设置页「电池优化白名单」再进。
 *
 * 挂在首页（配对成功后的落地页）而不是 App onLaunch：首启还没配对时引导关电池
 * 优化毫无意义，用户也不知道那是干嘛的。
 */
export function useBatteryWhitelistPrompt() {
  onShow(() => {
    // #ifdef APP-PLUS
    if (!isKeepAliveAvailable() || !isKeepAliveEnabled() || !hasLocalPairing())
      return;
    try {
      if (uni.getStorageSync(CACHE_KEY.BATTERY_PROMPT_DONE))
        return;
    }
    catch { /* 读不到就当作没提示过 */ }
    // 已豁免（或查询失败按未豁免处理）——已豁免则没什么可引导的
    if (isIgnoringBatteryOptimizations())
      return;

    uni.showModal({
      title: '让监护在后台更稳定',
      content: '关闭本应用的电池优化，锁屏后监护连接才不容易被系统中断。点「去设置」后选择「允许」。',
      confirmText: '去设置',
      cancelText: '暂不',
      success: ({ confirm }) => {
        try {
          uni.setStorageSync(CACHE_KEY.BATTERY_PROMPT_DONE, true);
        }
        catch { /* 记不住最多再弹一次，不阻塞 */ }
        if (confirm)
          requestIgnoreBatteryOptimizations();
      },
    });
    // #endif
  });
}
