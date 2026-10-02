<route lang="json">
{ "layout": "tabbar" }
</route>

<script setup lang="ts">
import type { DailyStat, HistoryRecord, StatsSummary } from '@/api/baby';
import type { StatusEvent } from '@/utils/babyEvents';
import { onShow } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';
import { fetchDailyStats, fetchHistoryRange, fetchStatsSummary } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { deriveTimeline, fmtDateKey, fmtDuration } from '@/utils/babyEvents';
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
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
];
const period = ref<Period>('week');

const daily = ref<DailyStat[]>([]);
const summary = ref<StatsSummary | null>(null);
const sleepMs = ref(0);
const sleepMsByDay = ref<Record<string, number>>({});
/** 状态事件段（进入各状态的连续区间）：今日哭闹明细 / 夜间小睡拆分 / 分布时长共用 */
const statusEvents = ref<StatusEvent[]>([]);
/** 哭闹连续段（进入 crying 且有时长的切换） */
const cryEpisodes = ref<StatusEvent[]>([]);
const distribution = ref<{ status: string; ms: number; ratio: number }[]>([]);
/** 点选的柱子下标（null = 周期汇总）；两卡联动，再点一次取消。仅本周逐日柱可点 */
const selectedDayIndex = ref<number | null>(null);
/** 点选的分布色段（状态名），图例加粗强调 */
const selectedSeg = ref<string | null>(null);
/** 今日环比基线：昨天整天的哭闹次数（fetchDailyStats(2) 的首条） */
const prevDayCry = ref(0);
const WEEKDAY = '日一二三四五六';

const DIST_META: Record<string, { label: string; color: string }> = {
  sleeping: { label: '安睡', color: '#7BA05B' },
  awake: { label: '清醒', color: '#F2C14E' },
  playing: { label: '清醒活跃', color: '#E8825A' },
  crying: { label: '哭闹', color: '#D96A5B' },
};

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
  try {
    if (period.value === 'today') {
      // 昨天数据一并拉取：昨天作睡眠/哭闹环比基线（summary.total 是缓冲区全量，不能当昨日）
      const [sum, dailyStats, records] = await Promise.all([
        fetchStatsSummary(),
        fetchDailyStats(2),
        fetchHistoryRange(dayStart(Date.now() - 86_400_000).getTime(), Date.now()),
      ]);
      summary.value = sum;
      prevDayCry.value = dailyStats.length > 1 ? dailyStats[0].cryCount : 0;
      daily.value = dailyStats.slice(-1);
      applyDerived(records, Date.now(), dayStart(Date.now()).getTime());
    }
    else if (period.value === 'week') {
      daily.value = await fetchDailyStats(7);
      const start = dayStart(Date.now() - 6 * 86_400_000).getTime();
      const records = await fetchHistoryRange(start, Date.now());
      applyDerived(records, Date.now());
    }
    else {
      // 本月 = 自然月：从上月 1 日拉到现在，本月聚合与「较上月」环比共用一份数据
      const now = new Date();
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const spanDays = Math.ceil((Date.now() - prevMonthStart.getTime()) / 86_400_000) + 1;
      daily.value = await fetchDailyStats(spanDays);
      const records = await fetchHistoryRange(prevMonthStart.getTime(), Date.now());
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

/** 事件推导：安睡累计 + 哭闹段 + 状态分布（时长口径，与图例展示同源）。
 *  sinceMs：分布/哭闹段的统计起点（今日视图拉了昨天数据作环比基线，需裁掉） */
function applyDerived(records: HistoryRecord[], rangeEnd: number, sinceMs?: number) {
  const { sleepMs: sleep, sleepMsByDay: byDay, events } = deriveTimeline(records, rangeEnd);
  sleepMs.value = sleep;
  sleepMsByDay.value = byDay;
  statusEvents.value = events;
  const scoped = sinceMs === undefined ? events : events.filter(e => e.time >= sinceMs);
  cryEpisodes.value = scoped.filter(e => e.to === 'crying' && e.durationMs > 0);
  const statusMs: Record<string, number> = {};
  let totalMs = 0;
  for (const e of scoped) {
    if (!(e.to in DIST_META))
      continue; // offline 等未归类段并入「其他时段」
    statusMs[e.to] = (statusMs[e.to] ?? 0) + e.durationMs;
    totalMs += e.durationMs;
  }
  distribution.value = Object.entries(statusMs)
    .map(([status, ms]) => ({ status, ms, ratio: totalMs > 0 ? ms / totalMs : 0 }))
    .sort((a, b) => b.ratio - a.ratio);
}

/* ------------------------------------------------------------------ */
/*  展示计算                                                            */
/* ------------------------------------------------------------------ */
const pad2 = (n: number): string => String(n).padStart(2, '0');
const dayOfMonth = (dateKey: string): number => Number(dateKey.slice(8));
const todayKey = computed(() => fmtDateKey(Date.now()));
const monthPrefix = computed(() => todayKey.value.slice(0, 7));
const prevMonthPrefix = computed(() => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
});
const elapsedDays = computed(() => Math.max(1, dayOfMonth(todayKey.value)));

/** 今日哭闹单次明细（升序） */
const todayEpisodes = computed(() =>
  cryEpisodes.value.filter(e => fmtDateKey(e.time) === todayKey.value),
);

/** 今日睡眠夜间/小睡拆分：以睡眠段开始时刻判定，20:00–08:00 记夜间（近似口径） */
const sleepSplit = computed(() => {
  let nightMs = 0;
  let napMs = 0;
  for (const e of statusEvents.value) {
    if (e.to !== 'sleeping' || e.durationMs <= 0 || fmtDateKey(e.time) !== todayKey.value)
      continue;
    const h = new Date(e.time).getHours();
    if (h >= 20 || h < 8)
      nightMs += e.durationMs;
    else
      napMs += e.durationMs;
  }
  return { nightMs, napMs };
});

const todaySleepMs = computed(() => sleepMsByDay.value[todayKey.value] ?? 0);
const yestSleepMs = computed(() => sleepMsByDay.value[fmtDateKey(Date.now() - 86_400_000)] ?? 0);

function sumSleepByDay(prefix: string): number {
  let s = 0;
  for (const [k, ms] of Object.entries(sleepMsByDay.value)) {
    if (k.startsWith(prefix))
      s += ms;
  }
  return s;
}

const monthSleepMs = computed(() => sumSleepByDay(monthPrefix.value));
const prevMonthSleepMs = computed(() => sumSleepByDay(prevMonthPrefix.value));
const monthMaxSleep = computed(() => {
  const entries = Object.entries(sleepMsByDay.value).filter(([k, ms]) => k.startsWith(monthPrefix.value) && ms > 0);
  if (entries.length === 0)
    return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a));
});
const monthSleepAvg = computed(() => monthSleepMs.value / elapsedDays.value);

const cryTotal = computed(() => {
  if (period.value === 'today')
    return summary.value?.today.cryCount ?? 0;
  const scope = period.value === 'month'
    ? daily.value.filter(d => d.date.startsWith(monthPrefix.value))
    : daily.value;
  return scope.reduce((s, d) => s + d.cryCount, 0);
});
const prevMonthCry = computed(() =>
  daily.value.filter(d => d.date.startsWith(prevMonthPrefix.value)).reduce((s, d) => s + d.cryCount, 0),
);

/** 本月柱状图：自然月按周聚合 5 柱（1-7日…月末，规范 5.3） */
const monthBuckets = computed(() => {
  if (period.value !== 'month')
    return [];
  const n = new Date();
  const monthLen = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  const bounds: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28], [29, monthLen]];
  const cur = daily.value.filter(d => d.date.startsWith(monthPrefix.value));
  return bounds.map(([a, b]) => {
    const seg = cur.filter(d => dayOfMonth(d.date) >= a && dayOfMonth(d.date) <= b);
    return {
      key: `${a}-${b}日`,
      label: `${a}-${b}日`,
      sample: seg.reduce((s, d) => s + d.sampleCount, 0),
      cry: seg.reduce((s, d) => s + d.cryCount, 0),
    };
  });
});

/** 柱状图数据源：本周 = 最近 7 天逐日（可点选下钻）；本月 = 周聚合（展示为主） */
const chartBars = computed(() => {
  if (period.value === 'week') {
    return daily.value.map((d, i) => ({
      key: d.date,
      label: i === daily.value.length - 1 ? '今天' : `周${WEEKDAY[new Date(`${d.date}T00:00:00`).getDay()]}`,
      sample: d.sampleCount,
      cry: d.cryCount,
      selectable: true,
      isToday: i === daily.value.length - 1,
    }));
  }
  return monthBuckets.value.map(b => ({ ...b, selectable: false, isToday: false }));
});
const sampleMax = computed(() => Math.max(1, ...chartBars.value.map(b => b.sample)));
const cryMax = computed(() => Math.max(1, ...chartBars.value.map(b => b.cry)));

/** 柱高百分比（相对组内最大值，最低 6% 保证可点视觉存在） */
function barHeight(value: number, max: number): string {
  if (max <= 0 || value <= 0)
    return '6%';
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

const selectedDay = computed(() => (selectedDayIndex.value === null ? null : daily.value[selectedDayIndex.value]));

/** 下钻：跳转历史页并联动日期选择条定位到选中日（规范 5.2，仅本周逐日柱） */
function drillToDay() {
  const d = selectedDay.value;
  if (!d)
    return;
  // 选中的就是今天 → 就地切到「今日」周期查看当天明细，不跳历史页
  // （今日视图本身就是当天数据；历史页仅用于回看更早的日子）
  if (selectedDayIndex.value === daily.value.length - 1) {
    setPeriod('today');
    return;
  }
  uni.setStorageSync('STATS_DRILL_DATE', d.date);
  uni.switchTab({ url: '/pages/history/index' });
}

const sleepValue = computed(() => {
  if (selectedDay.value)
    return fmtDuration(sleepMsByDay.value[selectedDay.value.date] ?? 0);
  if (period.value === 'today')
    return fmtDuration(todaySleepMs.value);
  if (period.value === 'month')
    return `日均 ${fmtDuration(monthSleepAvg.value)}`;
  return fmtDuration(sleepMs.value);
});

const sleepAvgText = computed(() => {
  const n = Math.max(1, daily.value.filter(d => d.sampleCount > 0).length);
  return fmtDuration(sleepMs.value / n);
});

const sleepMaxDay = computed(() => {
  const entries = Object.entries(sleepMsByDay.value).filter(([, ms]) => ms > 0);
  if (entries.length === 0)
    return null;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a));
});

const selectedDayLabel = computed(() => {
  const d = selectedDay.value;
  if (!d)
    return '';
  const date = new Date(`${d.date}T00:00:00`);
  const isToday = d.date === todayKey.value;
  return `${isToday ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`} · 周${WEEKDAY[date.getDay()]}`;
});

const sleepSub = computed(() => {
  if (selectedDay.value)
    return `已选中：${selectedDayLabel.value} · 点击空白处返回汇总`;
  if (period.value === 'today')
    return `夜间 ${fmtDuration(sleepSplit.value.nightMs)} · 小睡 ${fmtDuration(sleepSplit.value.napMs)}`;
  if (period.value === 'month') {
    const max = monthMaxSleep.value;
    return `合计 ${fmtDuration(monthSleepMs.value)} · 最长 ${max ? `${fmtDuration(max[1])}（${Number(max[0].slice(5, 7))}/${dayOfMonth(max[0])}）` : '--'}`;
  }
  return `日均 ${sleepAvgText.value}${sleepMaxDay.value ? ` · 最长 ${fmtDuration(sleepMaxDay.value[1])}（周${WEEKDAY[new Date(`${sleepMaxDay.value[0]}T00:00:00`).getDay()]}）` : ''}`;
});

/** 环比方向（规范 5.3）：睡眠↑=好转(绿)、哭闹↑=变差(红)；两期皆 0 不展示 */
function trendOf(cur: number, base: number): 'up' | 'down' | null {
  if (cur === 0 && base === 0)
    return null;
  if (cur === base)
    return null;
  return cur > base ? 'up' : 'down';
}

const trendSleep = computed<'up' | 'down' | null>(() => {
  if (period.value === 'today')
    return trendOf(todaySleepMs.value, yestSleepMs.value);
  if (period.value === 'month')
    return trendOf(monthSleepMs.value, prevMonthSleepMs.value);
  return null; // 本周不展示伪环比
});

const trendCry = computed<'up' | 'down' | null>(() => {
  if (period.value === 'today')
    return trendOf(summary.value?.today.cryCount ?? 0, prevDayCry.value);
  if (period.value === 'month')
    return trendOf(cryTotal.value, prevMonthCry.value);
  return null;
});

const cryBadgeText = computed(() => {
  if (period.value === 'today') {
    const diff = (summary.value?.today.cryCount ?? 0) - prevDayCry.value;
    return `较昨日 ${diff > 0 ? `+${diff}` : diff}`;
  }
  return `较上月 ${trendCry.value === 'up' ? '↑' : '↓'}`;
});

const cryValue = computed(() => `${selectedDay.value ? selectedDay.value.cryCount : cryTotal.value} 次`);

/** 哭闹副文统计口径：今日/本周看区间内单次，本月看本月单次 */
const subEpisodes = computed(() => {
  if (period.value === 'today')
    return todayEpisodes.value;
  if (period.value === 'month')
    return cryEpisodes.value.filter(e => fmtDateKey(e.time).startsWith(monthPrefix.value));
  return cryEpisodes.value;
});

const cryAvgText = computed(() => {
  const list = subEpisodes.value.map(e => e.durationMs);
  if (list.length === 0)
    return '--';
  return fmtDuration(list.reduce((s, ms) => s + ms, 0) / list.length);
});

const cryMaxText = computed(() => {
  const list = subEpisodes.value.map(e => e.durationMs);
  return list.length > 0 ? fmtDuration(Math.max(...list)) : '--';
});

const crySub = computed(() => {
  if (selectedDay.value)
    return `已选中：${selectedDayLabel.value} · 点击空白处返回汇总`;
  if (period.value === 'month')
    return `平均每周 ${(cryTotal.value * 7 / elapsedDays.value).toFixed(1)} 次 · 单次最长 ${cryMaxText.value}`;
  return `平均单次 ${cryAvgText.value} · 最长 ${cryMaxText.value}`;
});

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 堆叠条「其他时段」中性段 = 1 - 已归类占比（今日设计稿 36/8/5% + 其他时段） */
const neutralRatio = computed(() =>
  Math.max(0, 1 - distribution.value.reduce((s, d) => s + d.ratio, 0)),
);
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
          <view
            v-if="trendSleep"
            class="trend-badge rounded-pill flex items-center gap-1"
            :class="{ 'trend-badge--rose': trendSleep === 'down' }"
          >
            <text class="trend-badge__text">{{ period === 'today' ? '较昨日' : '较上月' }} {{ trendSleep === 'up' ? '↑' : '↓' }}</text>
          </view>
        </view>
        <view
          class="stat-value-row flex items-center"
          :class="{ 'stat-value-row--link': selectedDay }"
          :role="selectedDay ? 'button' : undefined"
          :aria-label="selectedDay ? `查看 ${selectedDayLabel} 的详情` : undefined"
          @tap.stop="selectedDay && drillToDay()"
        >
          <text class="stat-value text-main font-bold block flex-1">{{ sleepValue }}</text>
          <template v-if="selectedDay">
            <text class="drill-hint text-secondary">查看当天</text>
            <image class="drill-hint__arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </template>
        </view>
        <text class="stat-sub text-secondary block">{{ sleepSub }}</text>

        <!-- 今日：夜间/小睡分解条 + 两行图例（规范 5.3，数据粒度决定图表形态） -->
        <template v-if="period === 'today' && todaySleepMs > 0">
          <view class="sleep-split flex overflow-hidden rounded-pill mt-4" role="img" :aria-label="`夜间 ${fmtDuration(sleepSplit.nightMs)} 占 ${Math.round(sleepSplit.nightMs / todaySleepMs * 100)}%，小睡 ${fmtDuration(sleepSplit.napMs)} 占 ${Math.round(sleepSplit.napMs / todaySleepMs * 100)}%`">
            <view class="sleep-split__seg" :style="{ flexGrow: sleepSplit.nightMs, backgroundColor: '#7BA05B' }" />
            <view v-if="sleepSplit.napMs > 0" class="sleep-split__seg" :style="{ flexGrow: sleepSplit.napMs, backgroundColor: '#DDE9D3' }" />
          </view>
          <view class="mt-2">
            <view class="dist-row flex items-center gap-2 mt-2">
              <view class="dist-row__dot rounded-full" :style="{ backgroundColor: '#7BA05B' }" />
              <text class="dist-row__label text-main flex-1">夜间睡眠</text>
              <text class="dist-row__value text-secondary">{{ fmtDuration(sleepSplit.nightMs) }} · {{ Math.round(sleepSplit.nightMs / todaySleepMs * 100) }}%</text>
            </view>
            <view class="dist-row flex items-center gap-2 mt-2">
              <view class="dist-row__dot rounded-full" :style="{ backgroundColor: '#DDE9D3' }" />
              <text class="dist-row__label text-main flex-1">小睡</text>
              <text class="dist-row__value text-secondary">{{ fmtDuration(sleepSplit.napMs) }} · {{ Math.round(sleepSplit.napMs / todaySleepMs * 100) }}%</text>
            </view>
          </view>
        </template>

        <!-- 本周：7 日逐日柱（可点选）；本月：周聚合 5 柱（展示为主） -->
        <view v-else-if="period !== 'today'" class="bars flex items-end justify-between mt-4" :class="{ 'bars--month': period === 'month' }">
          <view
            v-for="(b, i) in chartBars"
            :key="b.key"
            class="bars__col flex-1 flex flex-col"
            :aria-label="`${b.label}，监测样本 ${b.sample}`"
            :role="b.selectable ? 'button' : undefined"
            @tap.stop="b.selectable && toggleDay(i)"
          >
            <view class="bars__zone flex-1 w-full flex items-end justify-center">
              <view
                class="bars__bar rounded-sm w-full"
                :style="{
                  height: barHeight(b.sample, sampleMax),
                  backgroundColor: selectedDayIndex === i ? '#55823F' : (b.isToday ? '#7BA05B' : '#DDE9D3'),
                }"
              />
            </view>
            <text class="bars__label text-secondary" :class="{ 'bars__label--today text-main': b.isToday || selectedDayIndex === i }">{{ b.label }}</text>
          </view>
        </view>
      </view>

      <!-- ========= 哭闹次数卡 ========= -->
      <view class="card bg-card rounded-card mt-6" @tap="selectedDayIndex = null">
        <view class="flex items-center justify-between">
          <text class="card__title text-main font-semibold">哭闹次数</text>
          <view v-if="period === 'week' && cryTotal > 0" class="trend-badge trend-badge--amber rounded-pill">
            <text class="trend-badge__text text-amber-ink">{{ cryTotal }} 次</text>
          </view>
          <view v-else-if="trendCry" class="trend-badge rounded-pill" :class="{ 'trend-badge--rose': trendCry === 'up' }">
            <text class="trend-badge__text">{{ cryBadgeText }}</text>
          </view>
        </view>
        <view
          class="stat-value-row flex items-center"
          :class="{ 'stat-value-row--link': selectedDay }"
          :role="selectedDay ? 'button' : undefined"
          @tap.stop="selectedDay && drillToDay()"
        >
          <text class="stat-value text-main font-bold block flex-1">{{ cryValue }}</text>
          <template v-if="selectedDay">
            <text class="drill-hint text-secondary">查看当天</text>
            <image class="drill-hint__arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
          </template>
        </view>
        <text class="stat-sub text-secondary block">{{ crySub }}</text>

        <!-- 今日：两次哭闹明细行（红点 + 时间 + 时长，规范 5.3） -->
        <view v-if="period === 'today' && todayEpisodes.length > 0" class="mt-1">
          <view
            v-for="ep in todayEpisodes"
            :key="ep.time"
            class="episode-row flex items-center gap-2 mt-2"
            :aria-label="`${hhmm(ep.time)} 哭闹，持续 ${fmtDuration(ep.durationMs)}`"
          >
            <text class="episode-row__time text-secondary">{{ hhmm(ep.time) }}</text>
            <view class="episode-row__dot rounded-full" />
            <text class="episode-row__text text-main flex-1">哭闹 · 持续 {{ fmtDuration(ep.durationMs) }}</text>
          </view>
        </view>

        <!-- 本周/本月：柱状图 -->
        <view v-else-if="period !== 'today'" class="bars flex items-end justify-between mt-4" :class="{ 'bars--month': period === 'month' }">
          <view
            v-for="(b, i) in chartBars"
            :key="b.key"
            class="bars__col flex-1 flex flex-col"
            :aria-label="`${b.label}，哭闹 ${b.cry} 次`"
            :role="b.selectable ? 'button' : undefined"
            @tap.stop="b.selectable && toggleDay(i)"
          >
            <view class="bars__zone flex-1 w-full flex items-end justify-center">
              <view
                class="bars__bar rounded-sm w-full"
                :style="{
                  height: barHeight(b.cry, cryMax),
                  backgroundColor: selectedDayIndex === i ? '#B84A3C' : (b.isToday && b.cry > 0 ? '#D96A5B' : '#F5D9D3'),
                }"
              />
            </view>
            <text class="bars__label text-secondary" :class="{ 'bars__label--today text-main': b.isToday || selectedDayIndex === i }">{{ b.label }}</text>
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
            :class="{ 'dist-bar__seg--first': i === 0, 'dist-bar__seg--last': i === distribution.length - 1 && neutralRatio <= 0 }"
            :aria-label="`${DIST_META[d.status]?.label ?? d.status}，${fmtDuration(d.ms)}，占比 ${Math.round(d.ratio * 100)}%`"
            role="button"
            @tap.stop="selectedSeg = selectedSeg === d.status ? null : d.status"
          />
          <view
            v-if="neutralRatio > 0"
            class="dist-bar__seg"
            :style="{ flexGrow: neutralRatio, backgroundColor: '#EDE6D8' }"
            :aria-label="`其他时段，占比 ${Math.round(neutralRatio * 100)}%`"
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
            <text class="dist-row__value text-secondary">{{ fmtDuration(d.ms) }} · {{ Math.round(d.ratio * 100) }}%</text>
          </view>
        </view>
        <text v-else class="text-secondary block mt-4">暂无采样数据</text>
        <text class="footnote text-muted block text-center mt-3">其余为有动静事件片段，不计入状态时长</text>
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

/* ---------- 环比徽章（规范 5.3：睡眠↑绿/↓红，哭闹↑红/↓绿） ---------- */
.trend-badge {
  padding: 6rpx 18rpx;
  background-color: $color-primary-soft;

  &--amber {
    background-color: $color-amber-soft;
  }

  &--rose {
    background-color: $color-danger-soft;

    .trend-badge__text {
      color: $color-danger;
    }
  }

  &__text {
    font-size: 23rpx;
    font-weight: 500;
    color: $color-primary-deep;
  }
}

/* ---------- 7 日柱状（h48，今天高亮） / 本月周聚合 5 柱 ---------- */
.bars {
  height: 130rpx; // 柱 48px + 标签

  &--month .bars__bar {
    max-width: 84rpx; // 周聚合柱更宽更圆（设计稿 11-本月态）
    border-radius: 16rpx;
  }

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
    // text 在 H5 渲染为 inline,width/text-align 需要显式 block,才能与居中的立柱对中
    // 每列 flex-1 + 列内居中 = 标签锚定柱中心（规范 v1.1.18 逐柱定位规则）
    display: block;
    width: 100%;
    text-align: center;
    font-size: 20rpx;

    &--today {
      font-weight: 500;
    }
  }
}

/* ---------- 今日睡眠分解条（夜间/小睡） ---------- */
.sleep-split {
  height: 44rpx;

  &__seg {
    min-width: 24rpx;
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

/* ---------- 今日哭闹明细行 ---------- */
.episode-row {
  min-height: 48rpx;

  &__time {
    width: 88rpx;
    font-size: 25rpx;
  }

  &__dot {
    width: 14rpx;
    height: 14rpx;
    background-color: $color-danger;
  }

  &__text {
    font-size: 27rpx;
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
