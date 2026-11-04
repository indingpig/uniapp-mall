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
  background-color: #f4ede0;
  font-family: $font-family-base;
  color: #1f1f1f;
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
