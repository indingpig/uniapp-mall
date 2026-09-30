<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { DailyStat, HistoryRecord, StatsSummary } from '@/api/baby';
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { fetchDailyStats, fetchHistoryRange, fetchStatsSummary } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { deriveTimeline, fmtDateKey, fmtDuration, statusDistribution } from '@/utils/babyEvents';
import { getIcon } from '@/utils/icons';

const { capsuleTopGap } = useCapsuleGap();

/* ------------------------------------------------------------------ */
/*  首次空态门控                                                        */
/* ------------------------------------------------------------------ */
const hasPairedDevice = ref<boolean>(true);
onShow(() => {
  const paired = uni.getStorageSync(CACHE_KEY.PAIRED_DEVICE);
  hasPairedDevice.value = !!(paired && typeof paired === 'object' && paired.name);
  loadPeriod();
});

/* ------------------------------------------------------------------ */
/*  周期分段（今日 / 本周 / 本月）                                       */
/* ------------------------------------------------------------------ */
type Period = 'today' | 'week' | 'month';
const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: 'today', label: '今日', days: 1 },
  { key: 'week', label: '本周', days: 7 },
  { key: 'month', label: '本月', days: 30 },
];
const period = ref<Period>('week');
const days = computed(() => PERIODS.find(p => p.key === period.value)?.days ?? 7);

const daily = ref<DailyStat[]>([]);
const summary = ref<StatsSummary | null>(null);
const sleepMs = ref(0);
const sleepMsByDay = ref<Record<string, number>>({});
const distribution = ref<{ status: string; ratio: number }[]>([]);
/** 点选的柱子下标（null = 周期汇总）；两卡联动，再点一次取消 */
const selectedDayIndex = ref<number | null>(null);
/** 点选的分布色段（状态名），图例加粗强调 */
const selectedSeg = ref<string | null>(null);
/** 哭闹单次持续时长（ms 数组，来自事件推导） */
const cryEpisodesMs = ref<number[]>([]);
const WEEKDAY = '日一二三四五六';

function setPeriod(key: Period) {
  if (period.value === key)
    return;
  period.value = key;
  selectedDayIndex.value = null; // 切周期清空点选
  selectedSeg.value = null;
  loadPeriod();
}

/** 点选柱子查看当天；再点一次取消 */
function toggleDay(i: number) {
  selectedDayIndex.value = selectedDayIndex.value === i ? null : i;
}

async function loadPeriod() {
  if (!hasPairedDevice.value)
    return;
  const n = days.value;
  try {
    if (period.value === 'today') {
      const [sum, records] = await Promise.all([
        fetchStatsSummary(),
        fetchHistoryRange(dayStart(Date.now()).getTime(), Date.now()),
      ]);
      summary.value = sum;
      daily.value = [{
        date: new Date().toISOString().split('T')[0],
        maxRms: sum.today.maxRms,
        avgRms: sum.today.avgRms,
        cryCount: sum.today.cryCount,
        sampleCount: sum.today.sampleCount,
      }];
      applyDerived(records, Date.now());
    }
    else {
      daily.value = await fetchDailyStats(n);
      const start = dayStart(Date.now() - (n - 1) * 86_400_000).getTime();
      const records = await fetchHistoryRange(start, Date.now());
      applyDerived(records, Date.now());
    }
  }
  catch { /* 离线时保留空数据 */ }
}

function dayStart(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 事件推导：安睡累计 + 状态分布（采样条数近似时长，见脚注） */
function applyDerived(records: HistoryRecord[], rangeEnd: number) {
  const { sleepMs: sleep, sleepMsByDay: byDay, events } = deriveTimeline(records, rangeEnd);
  sleepMs.value = sleep;
  sleepMsByDay.value = byDay;
  cryEpisodesMs.value = events.filter(e => e.to === 'crying' && e.durationMs > 0).map(e => e.durationMs);
  distribution.value = statusDistribution(records);
}

/* ------------------------------------------------------------------ */
/*  展示计算                                                            */
/* ------------------------------------------------------------------ */
const DIST_META: Record<string, { label: string; color: string }> = {
  sleeping: { label: '安睡', color: '#7BA05B' },
  awake: { label: '清醒', color: '#F2C14E' },
  playing: { label: '清醒活跃', color: '#E8825A' },
  crying: { label: '哭闹', color: '#D96A5B' },
};

const cryTotal = computed(() =>
  period.value === 'today' ? summary.value?.today.cryCount ?? 0 : daily.value.reduce((s, d) => s + d.cryCount, 0),
);

const cryMax = computed(() => Math.max(1, ...daily.value.map(d => d.cryCount)));
const sampleMax = computed(() => Math.max(1, ...daily.value.map(d => d.sampleCount)));

/** 柱高百分比（相对组内最大值，最低 6% 保证可点视觉存在） */
function barHeight(value: number, max: number): string {
  if (max <= 0 || value <= 0)
    return '6%';
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

const selectedDay = computed(() => (selectedDayIndex.value === null ? null : daily.value[selectedDayIndex.value]));

/** 下钻：跳转历史页并联动日期选择条定位到选中日（规范 5.2） */
function drillToDay() {
  const d = selectedDay.value;
  if (!d)
    return;
  uni.setStorageSync('STATS_DRILL_DATE', d.date);
  uni.switchTab({ url: '/pages/history/index' });
}

const sleepText = computed(() => {
  const d = selectedDay.value;
  if (d)
    return fmtDuration(sleepMsByDay.value[d.date] ?? 0);
  return fmtDuration(sleepMs.value);
});
const sleepAvgText = computed(() => {
  const n = Math.max(1, daily.value.filter(d => d.sampleCount > 0).length);
  return fmtDuration(sleepMs.value / n);
});

/** 环比：今天 vs 昨天（今日视角）；本周视角不展示伪环比 */
const trend = computed<'up' | 'down' | null>(() => {
  if (period.value !== 'today' || daily.value.length === 0)
    return null;
  return (summary.value?.today.cryCount ?? 0) <= (summary.value?.total.cryCount ?? 0) ? 'down' : 'up';
});

function barLabel(i: number): string {
  if (period.value === 'today')
    return `${i}`; // 小时
  const d = daily.value[i];
  if (!d)
    return '';
  const date = new Date(`${d.date}T00:00:00`);
  if (period.value === 'week')
    return i === daily.value.length - 1 ? '今天' : `周${WEEKDAY[date.getDay()]}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const sleepMaxDay = computed(() => {
  const entries = Object.entries(sleepMsByDay.value).filter(([, ms]) => ms > 0);
  if (entries.length === 0)
    return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a));
});

const cryAvgText = computed(() => {
  const list = cryEpisodesMs.value;
  if (list.length === 0)
    return '--';
  return fmtDuration(list.reduce((s, ms) => s + ms, 0) / list.length);
});

const cryMaxText = computed(() => {
  const list = cryEpisodesMs.value;
  return list.length > 0 ? fmtDuration(Math.max(...list)) : '--';
});

const selectedDayLabel = computed(() => {
  const d = selectedDay.value;
  if (!d)
    return '';
  const date = new Date(`${d.date}T00:00:00`);
  const isToday = d.date === fmtDateKey(Date.now());
  return `${isToday ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`} · 周${WEEKDAY[date.getDay()]}`;
});

const barCount = computed(() => daily.value.length);
</script>

<template>
  <view class="page">
    <view class="navbar" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <text class="page-title text-main font-bold">统计</text>
    </view>

    <!-- ========= 首次空态门控 ========= -->
    <view v-if="!hasPairedDevice" class="empty text-center">
      <image class="empty__img" src="/static/icons/ic-monitor-wave.svg" mode="aspectFit" />
      <text class="empty__text block text-secondary">连接设备后，这里会展示宝宝的统计回顾</text>
    </view>

    <template v-else>
      <!-- ========= 周期分段控件 ========= -->
      <view class="seg bg-card rounded-pill flex items-center px-1">
        <view
          v-for="p in PERIODS"
          :key="p.key"
          class="seg__item flex-1 flex items-center justify-center rounded-pill"
          :class="{ 'seg__item--active bg-primary': period === p.key }"
          @tap="setPeriod(p.key)"
        >
          <text class="seg__label" :class="period === p.key ? 'text-white font-medium' : 'text-secondary'">{{ p.label }}</text>
        </view>
      </view>

      <!-- ========= 睡眠时长卡 ========= -->
      <view class="card bg-card rounded-card mt-6" @tap="selectedDayIndex = null">
        <view class="flex items-center justify-between">
          <text class="card__title text-main font-semibold">睡眠时长</text>
          <view v-if="trend && !selectedDay" class="trend-badge rounded-pill flex items-center gap-1">
            <text class="trend-badge__text">{{ trend === 'up' ? '较上周 ↑' : '较上周 ↓' }}</text>
          </view>
        </view>
        <view
          class="stat-value-row flex items-center"
          :class="{ 'stat-value-row--link': selectedDay }"
          :role="selectedDay ? 'button' : undefined"
          :aria-label="selectedDay ? `查看 ${selectedDayLabel} 的详情` : undefined"
          @tap.stop="selectedDay && drillToDay()"
        >
          <text class="stat-value text-main font-bold block flex-1">{{ sleepText }}</text>
          <template v-if="selectedDay">
            <text class="drill-hint text-secondary">查看当天</text>
            <image class="drill-hint__arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </template>
        </view>
        <text class="stat-sub text-secondary block">
          {{ selectedDay
            ? `已选中：${selectedDayLabel} · 点击空白处返回汇总`
            : `日均 ${sleepAvgText}${sleepMaxDay ? ` · 最长 ${fmtDuration(sleepMaxDay[1])}（周${WEEKDAY[new Date(`${sleepMaxDay[0]}T00:00:00`).getDay()]}）` : ''}` }}
        </text>
        <view class="bars flex items-end justify-between mt-4">
          <view
            v-for="(d, i) in daily"
            :key="d.date"
            class="bars__col flex-1 flex flex-col"
            :aria-label="`${barLabel(i)}，监测样本 ${d.sampleCount}`"
            role="button"
            @tap.stop="toggleDay(i)"
          >
            <view class="bars__zone flex-1 w-full flex items-end justify-center">
              <view
                class="bars__bar rounded-sm w-full"
                :class="{ 'bars__bar--today bg-primary': i === barCount - 1 && selectedDayIndex !== i }"
                :style="{ height: barHeight(d.sampleCount, sampleMax), backgroundColor: selectedDayIndex === i ? '#55823F' : undefined }"
              />
            </view>
            <text class="bars__label text-secondary" :class="{ 'bars__label--today text-main': i === barCount - 1 || selectedDayIndex === i }">{{ barLabel(i) }}</text>
          </view>
        </view>
      </view>

      <!-- ========= 哭闹次数卡 ========= -->
      <view class="card bg-card rounded-card mt-6" @tap="selectedDayIndex = null">
        <view class="flex items-center justify-between">
          <text class="card__title text-main font-semibold">哭闹次数</text>
          <view v-if="cryTotal > 0" class="trend-badge trend-badge--amber rounded-pill">
            <text class="trend-badge__text text-amber-ink">{{ cryTotal }} 次</text>
          </view>
        </view>
        <view
          class="stat-value-row flex items-center"
          :class="{ 'stat-value-row--link': selectedDay }"
          :role="selectedDay ? 'button' : undefined"
          @tap.stop="selectedDay && drillToDay()"
        >
          <text class="stat-value text-main font-bold block flex-1">{{ selectedDay ? `${selectedDay.cryCount} 次` : `${cryTotal} 次` }}</text>
          <template v-if="selectedDay">
            <text class="drill-hint text-secondary">查看当天</text>
            <image class="drill-hint__arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </template>
        </view>
        <text class="stat-sub text-secondary block">{{ selectedDay ? `已选中：${selectedDayLabel} · 点击空白处返回汇总` : `平均单次 ${cryAvgText} · 最长 ${cryMaxText}` }}</text>
        <view class="bars flex items-end justify-between mt-4">
          <view
            v-for="(d, i) in daily"
            :key="d.date"
            class="bars__col flex-1 flex flex-col"
            :aria-label="`${barLabel(i)}，哭闹 ${d.cryCount} 次`"
            role="button"
            @tap.stop="toggleDay(i)"
          >
            <view class="bars__zone flex-1 w-full flex items-end justify-center">
              <view
                class="bars__bar rounded-sm w-full"
                :style="{
                  height: barHeight(d.cryCount, cryMax),
                  backgroundColor: selectedDayIndex === i ? '#B84A3C' : (i === barCount - 1 && d.cryCount > 0 ? '#D96A5B' : '#F5D9D3'),
                }"
              />
            </view>
            <text class="bars__label text-secondary" :class="{ 'bars__label--today text-main': i === barCount - 1 || selectedDayIndex === i }">{{ barLabel(i) }}</text>
          </view>
        </view>
      </view>

      <!-- ========= 状态时间分布卡 ========= -->
      <view class="card bg-card rounded-card mt-6">
        <view class="flex items-center justify-between">
          <text class="card__title text-main font-semibold">状态时间分布</text>
          <text class="text-secondary">{{ PERIODS.find(p => p.key === period)?.label }}</text>
        </view>
        <view v-if="distribution.length > 0" class="dist-bar flex overflow-hidden rounded-pill mt-4">
          <view
            v-for="(d, i) in distribution"
            :key="d.status"
            :style="{ flexGrow: d.ratio, backgroundColor: DIST_META[d.status]?.color ?? '#EDE6D8' }"
            class="dist-bar__seg"
            :class="{ 'dist-bar__seg--first': i === 0, 'dist-bar__seg--last': i === distribution.length - 1 }"
            :aria-label="`${DIST_META[d.status]?.label ?? d.status}，占比 ${Math.round(d.ratio * 100)}%`"
            role="button"
            @tap.stop="selectedSeg = selectedSeg === d.status ? null : d.status"
          />
        </view>
        <view v-if="distribution.length > 0" class="mt-4">
          <view
            v-for="d in distribution"
            :key="d.status"
            class="dist-row flex items-center gap-2 mt-2"
            :class="{ 'dist-row--emphasized': selectedSeg === d.status }"
          >
            <view class="dist-row__dot rounded-full" :style="{ backgroundColor: DIST_META[d.status]?.color }" />
            <text class="dist-row__label text-main flex-1">{{ DIST_META[d.status]?.label ?? d.status }}</text>
            <text class="dist-row__value text-secondary">{{ Math.round(d.ratio * 100) }}%</text>
          </view>
        </view>
        <text v-else class="text-secondary block mt-4">暂无采样数据</text>
        <text class="footnote text-muted block text-center mt-3">按采样条数近似状态占比，仅供参考</text>
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
  padding: 32rpx 0 20rpx;
}

.page-title {
  font-size: 44rpx; // display 23px
}

/* ---------- 分段控件（h42 r22） ---------- */
.seg {
  height: 81rpx;
  border: 1px solid $color-border;

  &__item {
    height: 69rpx;

    &--active {
      box-shadow: 0 2rpx 8rpx rgba(60, 50, 30, 0.08);
    }
  }

  &__label {
    font-size: 27rpx;
  }
}

/* ---------- 卡片通用 ---------- */
.card {
  padding: 32rpx;
}

.card__title {
  font-size: 31rpx; // card-title 15px
}

.stat-value {
  margin-top: 16rpx;
  font-size: 42rpx; // 22px
}

.stat-sub {
  margin-top: 8rpx;
  font-size: 25rpx;
}

/* ---------- 环比徽章 ---------- */
.trend-badge {
  padding: 6rpx 18rpx;
  background-color: $color-primary-soft;

  &--amber {
    background-color: $color-amber-soft;
  }

  &__text {
    font-size: 23rpx;
    font-weight: 500;
    color: $color-primary-deep;
  }
}

/* ---------- 点选日期 chip ---------- */
/* ---------- 7 日柱状（h48，今天高亮） ---------- */
.bars {
  height: 130rpx; // 柱 48px + 标签

  &__col {
    height: 100%;
  }

  &__bar {
    max-width: 40rpx;
    min-height: 8rpx;
    transition: height 150ms ease; // 规范 5.2：周期切换 150ms 联动
  }

  // 柱区：柱子从这里"向上长"，标签行固定在底部
  &__zone {
    min-height: 0;
  }

  &__label {
    font-size: 23rpx;

    &--today {
      font-weight: 500;
    }
  }
}

/* ---------- 状态分布堆叠条 ---------- */
.dist-bar {
  height: 24rpx;

  &__seg--first {
    border-radius: 12rpx 0 0 12rpx;
  }

  &__seg--last {
    border-radius: 0 12rpx 12rpx 0;
  }
}

.dist-row {
  &__dot {
    width: 14rpx;
    height: 14rpx;
  }

  &__label {
    font-size: 27rpx;
  }

  &__value {
    font-size: 25rpx;
  }
}

.footnote {
  font-size: 21rpx;
}

/* ---------- 下钻行（选中日可点） ---------- */
.stat-value-row--link {
  cursor: pointer;
}

.drill-hint {
  font-size: 23rpx;
  white-space: nowrap;
}

.drill-hint__arrow {
  width: 28rpx;
  height: 28rpx;
  margin-left: 4rpx;
}

/* ---------- 分布图例强调 ---------- */
.dist-row--emphasized {
  .dist-row__label {
    font-weight: 700;
  }

  .dist-row__value {
    color: $color-text-primary;
    font-weight: 600;
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
