<script setup lang="ts">
import type { CardState } from '@/constants/babyStatus';
/**
 * 宝宝状态卡（设计规范 v1.1 第 5/8 节状态卡 + 12.1 离线变体）
 *
 * 结构：品牌橙脸 76px + 状态标题 19/600（状态语义色）+ 副标 13。
 * 全 App 唯一允许带投影的卡片（0 6 18 rgba(115,102,77,.08)，规范第 4 节）。
 * 离线变体：state='offline' → 灰脸 + 灰标题，副标由页面传
 * 「自动重连中 · 已尝试 N 次」（12.1）。
 *
 * @example
 *   <BabyStatusCard state="sleep" subtitle="已持续 1:23:45" />
 *   <BabyStatusCard state="offline" subtitle="自动重连中 · 已尝试 3 次" />
 */
import { computed } from 'vue';
import { STATUS_META } from '@/constants/babyStatus';

interface Props {
  /** 状态（5 态 + 设备离线） */
  state: CardState;
  /** 副标：正常态传「已持续 1:23:45」，离线态传「自动重连中 · 已尝试 N 次」 */
  subtitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  subtitle: '',
});

const meta = computed(() => STATUS_META[props.state]);
</script>

<template>
  <view class="status-card">
    <image class="status-card__face" :src="meta.face" mode="aspectFit" />
    <text class="status-card__title" :style="{ color: meta.color }">{{ meta.text }}</text>
    <text
      v-if="subtitle"
      class="status-card__subtitle"
      :class="{ 'status-card__subtitle--muted': state === 'offline' }"
    >
      {{ subtitle }}
    </text>
  </view>
</template>

<style scoped lang="scss">
.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: rpx(24) rpx(20);
  background-color: $color-card;
  border-radius: $radius-card-lg;
  /* 规范第 4 节：仅状态卡有投影，其余卡片靠 1px 描边分层 */
  box-shadow: 0 rpx(6) rpx(18) rgba(115, 102, 77, 0.08);
}

.status-card__face {
  width: rpx(76);
  height: rpx(76);
}

.status-card__title {
  margin-top: rpx(12);
  font-size: rpx(19);
  font-weight: 600;
}

.status-card__subtitle {
  margin-top: rpx(4);
  font-size: rpx(13);
  color: $color-text-secondary;
}

.status-card__subtitle--muted {
  color: $color-text-muted;
}
</style>
