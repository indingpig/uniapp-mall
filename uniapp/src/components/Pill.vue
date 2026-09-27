<script setup lang="ts">
/**
 * 状态徽章 pill（设计规范 v1.1 第 8 节「徽章」+ 12.3「监听中」徽章）
 *
 * 语义三色：green=仅记录 · amber=记录+事件 · red=立即推送。
 * 保持自绘（规范 14.3）：uni-tag 的 success 绿 ≠ 画布 #7BA05B，状态语义色必须精确。
 * dot=true 渲染 6px 闪烁圆点（监听中徽章，1s ease infinite，规范 13.1 P0），
 * 圆点取 currentColor 随语义色走。
 *
 * @example
 *   <Pill tone="green" text="仅记录" />
 *   <Pill tone="red" text="立即推送" />
 *   <Pill tone="green" size="sm" dot text="监听中" />
 */
import { useSlots } from 'vue';

interface Props {
  /** 语义色 */
  tone?: 'green' | 'amber' | 'red';
  /** md：22px 高 / 11px 字（在线徽章）；sm：20px 高 / 10px 字（图例、监听中） */
  size?: 'sm' | 'md';
  /** 前置闪烁圆点 */
  dot?: boolean;
  /** 文本（也可用默认插槽自定义内容） */
  text?: string;
}

withDefaults(defineProps<Props>(), {
  tone: 'green',
  size: 'md',
  dot: false,
  text: '',
});

const slots = useSlots();
</script>

<template>
  <view class="pill" :class="[`pill--${tone}`, `pill--${size}`]">
    <view v-if="dot" class="pill__dot" />
    <slot v-if="slots.default" />
    <text v-else class="pill__text">{{ text }}</text>
  </view>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 999px;
  font-weight: 600;
}

.pill--md {
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
}

.pill--sm {
  height: 20px;
  padding: 0 10px;
  font-size: 10px;
}

.pill--green {
  background-color: $color-primary-soft;
  color: $color-primary-deep;
}

.pill--amber {
  background-color: $color-amber-soft;
  color: $color-amber-ink;
}

.pill--red {
  background-color: $color-danger-soft;
  color: $color-danger;
}

.pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
  animation: pill-blink 1s ease infinite;
}

@keyframes pill-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
