<script setup>
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';

// 采集时保持屏幕常亮 (App 端)
onLaunch(() => {
  uni.setKeepScreenOn({ keepScreenOn: true });
});

onShow(() => {});
onHide(() => {});
</script>

<style>
page {
  background-color: #0f1420;
  color: #e8ecf4;
  font-family: -apple-system, "PingFang SC", sans-serif;
}
</style>
