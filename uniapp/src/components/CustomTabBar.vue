<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { onHide, onShow } from '@dcloudio/uni-app';
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
 * 改为「FLIP」：点击时把来源 tab 写入 storage，新页挂载/onShow 时滑块先落到来源
 * 位置再滑向目标——视觉上高亮从旧 tab 平滑移过来。
 * 真机 webview 显示早于 JS：onShow 触发时旧位置的滑块可能已先画出一帧（鬼畜闪烁），
 * 故采用「隐藏 → 关过渡就位 → 双 rAF 后显示并开过渡滑动」三段式，替代裸定时器。 */
const thumbIndex = ref(activeIndex.value);
const thumbReady = ref(false);
const thumbShown = ref(false);

/* 每实例 400ms 去抖：App 端挂载后 onShow 可能附加触发一次，同页重复触发会重启动画；
 * 各 tab 页是不同实例，互相之间不受影响 */
let lastFlipAt = 0;

/* 推导就绪/变化后，滑块目标位跟随 activeIndex（仅在开启动画后生效，避免抢在起点绘制前跳位） */
watch(activeIndex, (idx) => {
  if (thumbReady.value)
    thumbIndex.value = idx;
});

/* 双 rAF：确保「起点位」先完成一帧绘制，再在同一回调里显示 + 开过渡滑向目标。
 * rAF 在不可见/后台 webview 会被暂停，加 80ms 定时兜底，避免滑块卡死在隐藏态 */
function nextFrame(cb: () => void) {
  let fired = false;
  const run = () => {
    if (!fired) {
      fired = true;
      cb();
    }
  };
  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 80);
}

function playFlip() {
  const now = Date.now();
  if (now - lastFlipAt < 400)
    return;
  lastFlipAt = now;

  const prevKey = uni.getStorageSync(CACHE_KEY.TABBAR_PREV) as string;
  const prevIndex = TABS.findIndex(t => t.key === prevKey);
  const target = activeIndex.value;

  // 隐藏 → 关过渡落到起点（有来源 tab 则来源位，否则直接目标位）
  thumbShown.value = false;
  thumbReady.value = false;
  thumbIndex.value = prevIndex >= 0 && prevIndex !== target ? prevIndex : target;

  nextFrame(() => {
    thumbReady.value = true;
    thumbShown.value = true;
    thumbIndex.value = target;
  });
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

/* 离开页面即隐藏滑块：缓存页回显早于 JS 执行，先把旧位置藏住，
 * 回显时由 playFlip 在隐藏状态下就位后再显示，杜绝残影 */
onHide(() => {
  thumbShown.value = false;
});

const thumbStyle = computed(() => ({
  transform: `translateX(${thumbIndex.value * 100}%)`,
  transition: thumbReady.value
    ? 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s ease'
    : 'none',
  opacity: thumbShown.value ? 1 : 0,
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
        :src="getIcon(tab.icon, current === tab.key ? 'white' : 'disabled')"
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
  box-shadow: $shadow-tabbar;
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
    color: $color-disabled; // 规范：未激活 Tab

    &--active {
      color: $color-white;
      font-weight: 500;
    }
  }
}
</style>
