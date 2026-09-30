<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { HistoryRecord } from '@/api/baby';
import type { IconKey } from '@/utils/icons';
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { fetchHistoryRange } from '@/api/baby';
import { EVENT_META } from '@/constants/babyStatus';
import { CACHE_KEY } from '@/constants/cache';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { deriveTimeline, fmtDuration } from '@/utils/babyEvents';
import { getIcon } from '@/utils/icons';

const { capsuleTopGap } = useCapsuleGap();

/* ------------------------------------------------------------------ */
/*  首次空态门控（与首页一致：未配对设备显示空壳）                        */
/* ------------------------------------------------------------------ */
const hasPairedDevice = ref<boolean>(true);
const DAY_MS = 86_400_000;
const dayOffset = ref(0); // 0 = 今天
onShow(() => {
  const paired = uni.getStorageSync(CACHE_KEY.PAIRED_DEVICE);
  hasPairedDevice.value = !!(paired && typeof paired === 'object' && paired.name);
  // 统计页下钻联动：读取目标日期并定位（规范 5.2）
  const drill = uni.getStorageSync('STATS_DRILL_DATE');
  if (drill && typeof drill === 'string') {
    uni.removeStorageSync('STATS_DRILL_DATE');
    const drillMs = new Date(`${drill}T00:00:00`).getTime();
    const todayMs = new Date();
    todayMs.setHours(0, 0, 0, 0);
    // dayOffset 正数 = 往过去走（shiftDay(1) 即回退一天），过去日期取正偏移
    const diffDays = Math.round((drillMs - todayMs.getTime()) / 86_400_000);
    dayOffset.value = Math.min(6, Math.max(0, -diffDays));
  }
  loadDay();
});

/* ------------------------------------------------------------------ */
/*  日期选择（保留 7 天，今天右箭头禁用）                                 */
/* ------------------------------------------------------------------ */
const selectedDate = computed(() => new Date(Date.now() - dayOffset.value * DAY_MS));
const dateText = computed(() => {
  const d = selectedDate.value;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
});
const subText = computed(() => {
  if (dayOffset.value === 0)
    return '今天';
  const d = selectedDate.value;
  return `周${'日一二三四五六'[d.getDay()]}`;
});
const isToday = computed(() => dayOffset.value === 0);

function shiftDay(delta: number) {
  const next = dayOffset.value + delta;
  if (next < 0 || next > 6)
    return; // 保留 7 天
  dayOffset.value = next;
  loadDay();
}

/* ------------------------------------------------------------------ */
/*  数据：当天记录 → 事件时间线 + 概要                                   */
/* ------------------------------------------------------------------ */
interface TimelineRow {
  key: string;
  timeText: string;
  icon: IconKey;
  color: string;
  chipBg: string;
  title: string;
  detail: string;
}

const rows = ref<TimelineRow[]>([]);
const eventCount = ref(0);
const cryCount = ref(0);
const sleepMs = ref(0);
const loading = ref(false);

const META_TITLE: Record<string, string> = {
  sleeping: '开始安睡',
  awake: '开始清醒',
  playing: '清醒活跃',
  crying: '开始哭闹',
  offline: '设备离线',
};
const META_SUB: Record<string, string> = {
  sleeping: '音量回落至底噪区间',
  awake: '有咿呀声活动',
  playing: '持续发声，起伏较大',
  crying: '哭声特征匹配',
  offline: '连接中断',
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function loadDay() {
  const start = new Date(selectedDate.value);
  start.setHours(0, 0, 0, 0);
  const end = start.getTime() + DAY_MS;
  loading.value = true;
  fetchHistoryRange(start.getTime(), Math.min(end, Date.now()))
    .then((records: HistoryRecord[]) => {
      const { events, sleepMs: sleep, cryCount: cries } = deriveTimeline(records, Math.min(end, Date.now()));
      sleepMs.value = sleep;
      cryCount.value = cries;
      eventCount.value = events.length;
      rows.value = events.map((e) => {
        const m = EVENT_META[e.to as keyof typeof EVENT_META] ?? EVENT_META.offline;
        // 标题行 = 事件名 · 原因；副文 = 持续时长（≥1 分钟才显示，对齐设计稿 10）
        const title = `${META_TITLE[e.to] ?? '状态切换'} · ${META_SUB[e.to] ?? ''}`;
        const detail = e.durationMs >= 60_000 ? `持续 ${Math.round(e.durationMs / 60_000)} 分钟` : '短暂出现';
        return {
          key: `${e.time}`,
          timeText: fmtTime(e.time),
          icon: m.icon,
          color: m.color,
          chipBg: m.chipBg,
          title,
          detail,
        };
      });
    })
    .catch(() => {})
    .finally(() => { loading.value = false; });
}

const sleepText = computed(() => fmtDuration(sleepMs.value));
</script>

<template>
  <view class="page">
    <view class="navbar" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <text class="page-title text-main font-bold">历史</text>
    </view>

    <!-- ========= 首次空态门控 ========= -->
    <view v-if="!hasPairedDevice" class="empty text-center">
      <image class="empty__img" src="/static/icons/ic-monitor-wave.svg" mode="aspectFit" />
      <text class="empty__text block text-secondary">连接设备后，这里会记录宝宝的状态变化</text>
    </view>

    <template v-else>
      <!-- ========= 日期选择条 ========= -->
      <view class="date-bar bg-card rounded-card flex items-center">
        <view class="date-bar__arrow flex items-center justify-center" @tap="shiftDay(1)">
          <image class="date-bar__arrow-icon" :src="getIcon('chevron-left', dayOffset >= 6 ? '#B3AB9D' : '#3B362E')" mode="aspectFit" />
        </view>
        <view class="flex-1 text-center">
          <text class="date-bar__date text-main block">{{ dateText }}</text>
          <text class="date-bar__sub text-secondary block">{{ subText }}<text v-if="isToday"> · 周{{ '日一二三四五六'[new Date().getDay()] }}</text></text>
        </view>
        <view class="date-bar__arrow flex items-center justify-center" :class="{ 'date-bar__arrow--disabled': isToday }" @tap="!isToday && shiftDay(-1)">
          <image class="date-bar__arrow-icon" :src="getIcon('chevron-right', isToday ? '#B3AB9D' : '#3B362E')" mode="aspectFit" />
        </view>
      </view>

      <!-- ========= 概要三栏 ========= -->
      <view class="summary bg-card rounded-card flex items-center">
        <view class="summary__col flex-1 text-center">
          <text class="summary__value text-main font-bold">{{ eventCount }}</text>
          <text class="summary__label text-secondary block">事件总数</text>
        </view>
        <view class="summary__divider" />
        <view class="summary__col flex-1 text-center">
          <text class="summary__value font-bold text-danger">{{ cryCount }}</text>
          <text class="summary__label text-secondary block">哭闹提醒</text>
        </view>
        <view class="summary__divider" />
        <view class="summary__col flex-1 text-center">
          <text class="summary__value font-bold text-primary-deep">{{ sleepText }}</text>
          <text class="summary__label text-secondary block">累计安睡</text>
        </view>
      </view>

      <!-- ========= 时间线 ========= -->
      <view class="timeline bg-card rounded-card">
        <view class="flex items-center justify-between px-8 pt-6">
          <text class="timeline__title text-main font-semibold">时间线</text>
          <text class="timeline__meta text-secondary">共 {{ eventCount }} 条 · 倒序</text>
        </view>
        <view v-if="rows.length > 0" class="flex flex-col px-8 pb-4 pt-2">
          <view v-for="r in rows" :key="r.key" class="tl-row flex items-start gap-3">
            <text class="tl-row__time text-muted shrink-0">{{ r.timeText }}</text>
            <view class="tl-row__chip rounded-full flex items-center justify-center shrink-0" :style="{ background: r.chipBg }">
              <image class="tl-row__icon" :src="getIcon(r.icon, r.color)" mode="aspectFit" />
            </view>
            <view class="flex-1 min-w-0">
              <text class="tl-row__title text-main block">{{ r.title }}</text>
              <text class="tl-row__sub text-secondary block">{{ r.detail }}</text>
            </view>
          </view>
        </view>
        <view v-else class="timeline__empty flex flex-col items-center py-8 gap-2">
          <image class="timeline__empty-icon" :src="getIcon('clock-empty', '#D5CFC2')" mode="aspectFit" />
          <text class="text-secondary">当天暂无事件记录</text>
        </view>
        <text class="timeline__foot text-muted block text-center pb-4">事件记录保留 7 天 · 更早记录见统计页</text>
      </view>
    </template>

    <!-- 底部导航由 layouts/tabbar.vue 布局统一挂载 -->
  </view>
</template>

<style lang="scss">
page {
  background-color: $color-bg;
}
</style>

<style lang="scss" scoped>
.page {
  box-sizing: border-box;
  padding: 1.25rem;
  padding-top: var(--status-bar-height);
  min-height: 100vh;
  background-color: $color-bg;
  padding-bottom: 160rpx;
}

.navbar {
  gap: 20rpx;
  padding: 32rpx 0 20rpx;

  &__back {
    width: 56rpx;
    height: 56rpx;
  }
}

.page-title {
  font-size: 44rpx; // display 23px
}

/* ---------- 日期条 ---------- */
.date-bar {
  padding: 20rpx 24rpx;
  border: 1px solid $color-border;

  &__arrow {
    width: 56rpx;
    height: 56rpx;

    &--disabled {
      opacity: 0.4;
    }
  }

  &__arrow-icon {
    width: 36rpx;
    height: 36rpx;
  }

  &__date {
    font-size: 33rpx; // 17px
    font-weight: 600;
  }

  &__sub {
    margin-top: 4rpx;
    font-size: 25rpx;
  }
}

/* ---------- 概要三栏 ---------- */
.summary {
  margin-top: 27rpx;
  padding: 28rpx 0;

  &__value {
    font-size: 42rpx; // 大数值
  }

  &__label {
    margin-top: 8rpx;
    font-size: 25rpx;
  }

  &__divider {
    width: 1px;
    height: 56rpx;
    background-color: $color-divider;
  }
}

/* ---------- 时间线（行高档位：时间线行 38px） ---------- */
.timeline {
  margin-top: 27rpx;
  border: 1px solid $color-border;

  &__title {
    font-size: 31rpx; // card-title 15px(600)
    padding-bottom: 16rpx;
  }

  &__meta {
    font-size: 25rpx;
  }

  &__empty-icon {
    width: 72rpx;
    height: 72rpx;
  }

  &__foot {
    font-size: 21rpx;
    padding-top: 12rpx;
  }
}

.tl-row {
  // 时间线行档位 38px：内容 20 + 2 + 16，由行内元素自然撑开
  padding: 12rpx 0;

  &__time {
    width: 69rpx; // 时间沟 36px
    font-size: 25rpx;
    line-height: 39rpx; // 对齐 chip 中心
  }

  &__chip {
    width: 62rpx; // 32px
    height: 62rpx;
  }

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }

  &__title {
    font-size: 27rpx; // body 14px
    font-weight: 500;
  }

  &__sub {
    margin-top: 4rpx;
    font-size: 24rpx;
  }
}

/* ---------- 首次空态 ---------- */
.empty {
  padding: 80rpx 0;

  &__img {
    width: 160rpx;
    height: 160rpx;
  }

  &__text {
    margin-top: 16rpx;
    font-size: 25rpx;
  }
}
</style>
