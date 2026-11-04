<script setup>
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  console.warn('App Launch');
});
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
