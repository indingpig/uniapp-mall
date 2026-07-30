<script setup>
import { onHide, onLoad, onReady, onShow, onUnload } from '@dcloudio/uni-app';

onLoad(() => {
  console.warn('onLoad');
});
onHide(() => {
  console.warn('onHide');
});
onShow(() => {
  console.warn('onShow');
  // #ifdef MP-WEIXIN
  console.warn('MP-WEIXIN');
  // #endif
  // #ifdef H5
  console.warn('H5');
  // #endif
});
onUnload(() => {
  console.warn('onUnload');
});
onReady(() => {
  console.warn('onReady');
});
</script>

<template>
  <view />
</template>

<style>

</style>
