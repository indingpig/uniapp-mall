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
