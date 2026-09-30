<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { onShow } from '@dcloudio/uni-app';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { CACHE_KEY } from '@/constants/cache';
import { getIcon } from '@/utils/icons';

const props = defineProps<{
  /** 当前 tab；缺省时从页面路由自动推导（tab 页统一走 layouts/tabbar.vue，不再逐页传参） */
  current?: string;
}>();

// App/H5 端隐藏原生 TabBar（小程序端 custom:true 已自动隐藏）
// #ifdef APP-PLUS || H5
uni.hideTabBar();
// #endif

interface TabItem {
  key: string;
  label: string;
  icon: IconKey;
}

const TABS: readonly TabItem[] = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'history', label: '历史', icon: 'clock' },
  { key: 'stats', label: '统计', icon: 'bar-chart' },
  { key: 'settings', label: '设置', icon: 'gear' },
];

/* 实例与所属页面绑定（switchTab 整页替换、每页各挂一个），挂载时从路由推导一次即可 */
const derived = ref('');

function deriveFromRoute(): string {
  const pages = getCurrentPages();
  const route = pages[pages.length - 1]?.route ?? '';
  return route.replace(/^pages\//, '').replace(/\/index$/, '');
}

const current = computed(() => props.current ?? derived.value);
const activeIndex = computed(() => Math.max(0, TABS.findIndex(t => t.key === current.value)));

/* 高亮滑块：tab 切换是整页替换（uni.switchTab），组件会重建、无法跨页做 CSS 过渡。
 * 改为「FLIP」：切换前在 onTap 里把来源 tab 写入 storage，新页挂载时滑块先落在来源
 * 位置（关 transition），首帧绘制完成后再开 transition 滑到目标位置——视觉上高亮从旧 tab 移过来。
 * 推导（getCurrentPages）在挂载瞬间可能尚未就绪，故 activeIndex 就绪前后分两段处理。 */
const thumbIndex = ref(activeIndex.value);
const thumbReady = ref(false);

/* 推导就绪/变化后，滑块目标位跟随 activeIndex（仅在开启动画后生效，避免抢在起点绘制前跳位） */
watch(activeIndex, (idx) => {
  if (thumbReady.value)
    thumbIndex.value = idx;
});

/* 播放一次「起点→到位」动画；重复调用无害（settle 幂等，动画只会看起来更连贯） */
function playFlip() {
  const prevKey = uni.getStorageSync(CACHE_KEY.TABBAR_PREV) as string;
  const prevIndex = TABS.findIndex(t => t.key === prevKey);
  if (prevIndex >= 0 && prevIndex !== activeIndex.value) {
    // 关过渡先落到来源位，首帧绘制后再开启过渡滑到目标位
    thumbReady.value = false;
    thumbIndex.value = prevIndex;
    setTimeout(() => {
      thumbReady.value = true;
      thumbIndex.value = activeIndex.value;
    }, 30);
  }
  else {
    thumbReady.value = true;
    thumbIndex.value = activeIndex.value;
  }
}

onMounted(() => {
  derived.value = deriveFromRoute();

  if (derived.value) {
    playFlip();
  }
  else {
    // 冷启动/切页瞬间页面可能尚未入栈，下一帧再取
    nextTick(() => {
      derived.value = deriveFromRoute();
      playFlip();
    });
  }
});

/* tab 页在 H5/App 端会被框架缓存：再次 switchTab 回来不重新挂载（onMounted 不触发），
 * 动画必须挂在页面 onShow 上才能每次都播。首次显示时 derived 尚未就绪，由 onMounted
 * 统一处理，这里跳过以免重复播放。 */
onShow(() => {
  if (derived.value)
    playFlip();
});

const thumbStyle = computed(() => ({
  transform: `translateX(${thumbIndex.value * 100}%)`,
  transition: thumbReady.value
    ? 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)'
    : 'none',
}));

function onTap(key: string) {
  uni.setStorageSync(CACHE_KEY.TABBAR_PREV, current.value);
  uni.switchTab({ url: `/pages/${key}/index` });
}
</script>

<template>
  <view class="tab-bar fixed flex items-center bg-card z-10">
    <view class="tab-bar__thumb" :style="thumbStyle" />
    <view
      v-for="tab in TABS"
      :key="tab.key"
      class="tab flex-1 flex flex-col items-center justify-center"
      @tap="onTap(tab.key)"
    >
      <image
        class="tab__icon"
        :src="getIcon(tab.icon, current === tab.key ? '#ffffff' : '#A39B8C')"
        mode="aspectFit"
      />
      <text
        class="tab__label text-xs"
        :class="{ 'tab__label--active': current === tab.key }"
      >
        {{ tab.label }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.tab-bar {
  left: 32rpx;
  right: 32rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  height: 112rpx;
  border-radius: 56rpx;
  padding: 0 12rpx;
  box-shadow: 0 12rpx 32rpx rgba(60, 50, 30, 0.08);
}

.tab-bar__thumb {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
  width: calc((100% - 24rpx) / 4);
  height: 88rpx;
  border-radius: 44rpx;
  background-color: $color-primary;
  box-shadow: 0 8rpx 20rpx rgba(126, 162, 121, 0.35);
  will-change: transform;
}

.tab {
  position: relative; // 让图标/文字绘制在滑块之上（同为定位元素按 DOM 顺序）
  height: 88rpx;
  border-radius: 44rpx;
  gap: 4rpx;

  &__icon {
    width: 36rpx;
    height: 36rpx;
  }

  &__label {
    color: #A39B8C; // 规范：未激活 Tab

    &--active {
      color: #ffffff;
      font-weight: 500;
    }
  }
}
</style>
