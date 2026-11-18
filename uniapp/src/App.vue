<script setup>
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app';
import { isKeepAliveEnabled, startKeepAlive } from '@/utils/keepalive';
import { setAppForeground } from '@/utils/notify';
import { hasLocalPairing } from '@/utils/storage';

onLaunch(() => {
  console.warn('App Launch');
  // 后台保活（Android 前台服务）：开关打开且已配对时随启动拉起。
  // START_STICKY 重建进程后 JS 运行时不会自动恢复——用户点常驻通知回到 App，
  // 这里负责把服务与 WebSocket 全链路重新拉起
  if (isKeepAliveEnabled() && hasLocalPairing()) {
    startKeepAlive();
  }
});

// 前后台标记：哭声通知只在后台发（前台由页面内铃声/状态卡承担提醒）
onShow(() => setAppForeground(true));
onHide(() => setAppForeground(false));
</script>

<style lang="scss">
@use '@/styles/utilities.scss';

page {
  /* 页面底色与正文色走 styles/uni.scss token（此前写死 #f4ede0/#1f1f1f，与 $color-bg / $color-text-primary 不一致） */
  background-color: $color-bg;
  font-family: $font-family-base;
  color: $color-text-primary;
  font-size: 30rpx;
  line-height: 1.4;
}

/* uni 内置浮层（ActionSheet/Modal/Toast）挂在 page 外，不继承页面字体，显式对齐项目字体栈 */
uni-actionsheet,
uni-modal,
uni-toast {
  font-family: $font-family-base;
}
</style>
