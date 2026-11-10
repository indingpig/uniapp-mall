<script setup>
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app';
import { setAppForeground } from '@/utils/notify';

onLaunch(() => {
  console.warn('App Launch');
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
