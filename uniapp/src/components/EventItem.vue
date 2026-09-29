<script setup lang="ts">
import type { CardState } from '@/constants/babyStatus';
/**
 * 事件时间线行（设计规范 v1.1 第 5 节「今日事件」+ 第 10 节组件拆分）
 *
 * 结构：32px 彩色图标圈（16px 语义色图标）+「标题 · 副文本」+ 右侧时间戳 13 ink-3。
 * 图标/配色/默认标题由 state 从 EVENT_META 派生（双轨制：小图标随状态语义色）。
 * 基于 Cell 组装，divider/clickable 透传。
 *
 * @example
 *   <EventItem state="cry" detail="持续 2 分钟" time-text="14:32" />
 *   <EventItem state="sleep" time-text="12:21" divider />
 */
import { computed } from 'vue';
import { EVENT_META } from '@/constants/babyStatus';
import BaseIcon from './BaseIcon.vue';
import Cell from './Cell.vue';
import IconCircle from './IconCircle.vue';

interface Props {
  /** 事件对应的状态键（决定图标圈与默认标题） */
  state: CardState;
  /** 副文本（如「持续 2 分钟」「翻身声检测」「状态切换」） */
  detail?: string;
  /** 右侧时间戳 */
  timeText?: string;
  /** 覆盖默认标题（默认取 EVENT_META[state].title，如「哭声提醒」） */
  title?: string;
  divider?: boolean;
  clickable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  detail: '',
  timeText: '',
  title: '',
  divider: false,
  clickable: false,
});

const meta = computed(() => EVENT_META[props.state]);
</script>

<template>
  <Cell :divider="divider" :clickable="clickable">
    <template #icon>
      <IconCircle :bg="meta.chipBg">
        <BaseIcon :name="meta.icon" :size="16" :color="meta.color" />
      </IconCircle>
    </template>
    <template #title>
      <text class="event-item__title">{{ title || meta.title }}</text>
      <text v-if="detail" class="event-item__detail">· {{ detail }}</text>
    </template>
    <template #value>
      <text class="event-item__time">{{ timeText }}</text>
    </template>
  </Cell>
</template>

<style scoped>
.event-item__title {
  font-size: rpx(14);
  font-weight: 500;
  color: $color-text-primary;
}

.event-item__detail {
  font-size: rpx(14);
  font-weight: 400;
  color: $color-text-primary;
}

.event-item__time {
  font-size: rpx(13);
  color: $color-text-muted;
}
</style>
