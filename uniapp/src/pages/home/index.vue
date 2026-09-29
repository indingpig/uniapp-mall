<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { onShow } from '@dcloudio/uni-app';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { fetchBabyHistory } from '@/api/baby';
import { EVENT_META, QUIET_HINT, STATUS_META, toCardState, VOLUME_MAX_DB, VOLUME_MIN_DB, VOLUME_ZONES } from '@/constants/babyStatus';
import { CACHE_KEY } from '@/constants/cache';
import { useBabyMonitor } from '@/hooks/useBabyMonitor';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { getIcon } from '@/utils/icons';

/* ------------------------------------------------------------------ */
/*  服务端数据                                                          */
/* ------------------------------------------------------------------ */

const { status, volume, device, durationSec } = useBabyMonitor();

/* ------------------------------------------------------------------ */
/*  本地数据                                                            */
/* ------------------------------------------------------------------ */

const greeting = ref<string>('晚上好');
const userName = ref<string>('Sheldon');
const muted = ref<boolean>(false);
/** 首次空态（设计稿 08）：从未配对过设备时整页替换；默认 true 防闪 */
const hasPairedDevice = ref<boolean>(true);
const { capsuleTopGap } = useCapsuleGap();

/* ------------------------------------------------------------------ */
/*  状态卡（设计稿 06 状态图例语义）                                      */
/* ------------------------------------------------------------------ */

const meta = computed(() => {
  return STATUS_META[toCardState(status.value.status)];
});

const durationText = computed<string>(() => formatDuration(durationSec.value));

/* ------------------------------------------------------------------ */
/*  实时音量（设计规范 v1.1 第 7 节：三分区底 + 深绿填充 + 白游标）        */
/* ------------------------------------------------------------------ */

/** 音量% = clamp((dB − 30) / 60, 0, 1) */
const volumePercent = computed<number>(() => {
  const pct = ((volume.value.db - VOLUME_MIN_DB) / (VOLUME_MAX_DB - VOLUME_MIN_DB)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
});

/** 离线/无数据：-- dB + 灰条 */
const volumeOffline = computed<boolean>(() => !status.value.isOnline);

/** 在线但显示值 < 30 dB：环境底噪，空条 + 文案「安静」 */
const isQuiet = computed<boolean>(() => !volumeOffline.value && volumePercent.value <= 0);

const zoneIndex = computed<number>(() => {
  const i = VOLUME_ZONES.findIndex(z => volumePercent.value <= z.max);
  return i < 0 ? VOLUME_ZONES.length - 1 : i;
});

const zone = computed(() => VOLUME_ZONES[zoneIndex.value]);

const volumeDisplay = computed<string>(() =>
  volumeOffline.value ? '-- dB' : `${volume.value.db} dB`,
);

const volumeValueColor = computed<string>(() =>
  volumeOffline.value ? '#B3AB9D' : zone.value.color,
);

const volumeHint = computed<string>(() => {
  if (volumeOffline.value)
    return '设备离线，暂无法获取音量数据';
  return isQuiet.value ? QUIET_HINT : zone.value.hint;
});

/** 三分区宽度（60/20/20，由分区阈值推导） */
function zoneWidth(index: number): string {
  const start = index === 0 ? 0 : VOLUME_ZONES[index - 1].max;
  return `${VOLUME_ZONES[index].max - start}%`;
}

/* ------------------------------------------------------------------ */
/*  今日事件（从历史记录推导状态切换）                                    */
/* ------------------------------------------------------------------ */

interface BabyEvent {
  key: string;
  icon: IconKey;
  color: string;
  chipBg: string;
  title: string;
  detail: string;
  timeText: string;
}

const events = ref<BabyEvent[]>([]);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadEvents() {
  fetchBabyHistory()
    .then(({ items }) => {
      const list: BabyEvent[] = [];
      for (let i = 0; i < items.length - 1 && list.length < 3; i++) {
        const cur = items[i];
        const older = items[i + 1];
        if (cur.status === older.status)
          continue;
        const m = EVENT_META[toCardState(cur.status)];
        const durationMin = Math.round((cur.time - older.time) / 60000);
        list.push({
          key: `${cur.time}`,
          icon: m.icon,
          color: m.color,
          chipBg: m.chipBg,
          title: m.title,
          detail: cur.status === 'crying' && durationMin >= 1 ? `持续 ${durationMin} 分钟` : '状态切换',
          timeText: formatTime(cur.time),
        });
      }
      events.value = list;
    })
    .catch(() => {});
}

let eventTimer: ReturnType<typeof setInterval> | null = null;

/* ------------------------------------------------------------------ */
/*  方法                                                                */
/* ------------------------------------------------------------------ */

function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

function buildGreeting(): string {
  const h = new Date().getHours();
  if (h < 6)
    return '凌晨好';
  if (h < 11)
    return '早上好';
  if (h < 13)
    return '中午好';
  if (h < 18)
    return '下午好';
  return '晚上好';
}

function onBellTap() {
  uni.showToast({ title: '通知中心开发中', icon: 'none' });
}

function onListen() {
  uni.showToast({ title: '监听功能开发中', icon: 'none' });
}

function toggleMute() {
  muted.value = !muted.value;
  uni.showToast({ title: muted.value ? '已静音提醒' : '已恢复提醒', icon: 'none' });
}

function goPairing() {
  uni.navigateTo({ url: '/pages/pairing/index' });
}

function onHelpTap() {
  uni.showToast({ title: '帮助中心开发中', icon: 'none' });
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/index' });
}

function goSettings() {
  uni.switchTab({ url: '/pages/settings/index' });
}

/* ------------------------------------------------------------------ */
/*  生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(() => {
  loadEvents();
  eventTimer = setInterval(loadEvents, 30_000);
});

// 空态判定放 onShow：从配对页 navigateBack 返回时页面不会重新 mounted，
// 每次可见时重读配对标记，才能从空态切回正常态
onShow(() => {
  const paired = uni.getStorageSync(CACHE_KEY.PAIRED_DEVICE);
  hasPairedDevice.value = !!(paired && typeof paired === 'object' && paired.name);
  greeting.value = hasPairedDevice.value ? buildGreeting() : '你好'; // 空态无设备语境（规范 12.2）
});

onBeforeUnmount(() => {
  if (eventTimer) {
    clearInterval(eventTimer);
    eventTimer = null;
  }
});
</script>

<template>
  <view class="page h-full">
    <!-- ============== 主体内容 ============== -->
    <view class="main gap-3" :style="{ paddingTop: `${capsuleTopGap}px` }">
      <!-- 头部：问候语 + 通知铃铛 -->
      <view class="header flex items-center justify-between">
        <text class="header__greeting text-main font-bold">{{ greeting }}，{{ userName }}</text>
        <view class="bell relative" @tap="onBellTap">
          <image class="bell__icon" :src="getIcon('bell', '#3B362E')" mode="aspectFit" />
          <view v-if="hasPairedDevice" class="bell__dot rounded-full bg-coral absolute" />
        </view>
      </view>

      <!-- ========= 首次空态（设计稿 08）：未配对设备时整页替换 ========= -->
      <template v-if="!hasPairedDevice">
        <view class="empty-hero flex flex-col items-center">
          <view class="empty-hero__circle rounded-full bg-primary-soft flex items-center justify-center">
            <image class="empty-hero__img" src="/static/icons/ic-monitor-wave.svg" mode="aspectFit" />
          </view>
          <text class="empty-hero__title text-main font-semibold">还没有连接设备</text>
          <text class="empty-hero__desc text-secondary">连接宝宝监护器后，即可实时查看宝宝状态</text>
        </view>

        <view class="btn-cta rounded-pill bg-primary flex items-center justify-center gap-2" @tap="goPairing">
          <image class="btn-cta__icon" :src="getIcon('bluetooth', '#ffffff')" mode="aspectFit" />
          <text class="btn-cta__text text-white">去配对设备</text>
        </view>
        <text class="help-link text-secondary block text-center" @tap="onHelpTap">如何配对？查看教程</text>

        <view class="card rights-card bg-card rounded-lg mt-6">
          <text class="card__title text-main font-bold">连接后你将获得</text>
          <view class="rights-row flex items-center gap-3 mt-4">
            <view class="event-chip rounded-full bg-primary-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('mic', '#7BA05B')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">实时音量监测与三段告警</text>
          </view>
          <view class="rights-row flex items-center gap-3 mt-3">
            <view class="event-chip rounded-full bg-danger-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('droplet', '#D96A5B')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">哭声识别，立即推送到手机</text>
          </view>
          <view class="rights-row flex items-center gap-3 mt-3">
            <view class="event-chip rounded-full bg-amber-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('moon', '#D99A3D')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">睡眠记录与每日回顾</text>
          </view>
        </view>
      </template>

      <!-- ========= 正常主页 ========= -->
      <template v-else>
        <!-- 当前状态卡片 -->
        <view class="card card--status bg-card rounded-lg flex flex-col items-center">
          <image class="status-face" :src="meta.face" mode="aspectFit" />
          <text class="status-text font-bold" :style="{ color: meta.color }">
            {{ meta.text }}
          </text>
          <text class="status-duration text-secondary">已持续 {{ durationText }}</text>
        </view>

        <!-- 设备在线卡片 -->
        <view class="card bg-card rounded-lg flex items-center" @tap="goSettings">
          <image class="device-card__signal" :src="getIcon('wifi-signal', '#7BA05B')" mode="aspectFit" />
          <view class="flex-1 ml-3">
            <view class="flex items-center gap-2">
              <view class="device-card__dot rounded-full" :class="device.isOnline ? 'bg-primary' : 'bg-card-soft'" />
              <text class="device-card__title text-main">{{ device.isOnline ? '设备在线' : '设备离线' }}</text>
            </view>
            <text class="device-card__sub text-secondary block">{{ device.connectionText }}</text>
          </view>
          <image class="device-card__arrow" :src="getIcon('chevron-right', '#B3AB9D')" mode="aspectFit" />
        </view>

        <!-- 实时音量卡片 -->
        <view class="card bg-card rounded-lg">
          <view class="flex items-baseline justify-between">
            <text class="card__title text-main font-bold">实时音量</text>
            <text class="volume-value font-bold" :style="{ color: volumeValueColor }">{{ volumeDisplay }}</text>
          </view>
          <view class="vol-track relative">
            <view class="vol-zones flex h-full overflow-hidden rounded-pill">
              <view
                v-for="(z, i) in VOLUME_ZONES"
                :key="i"
                class="h-full"
                :style="{ background: z.soft, flexBasis: zoneWidth(i) }"
              />
            </view>
            <view
              v-if="!volumeOffline && !isQuiet"
              class="vol-fill absolute left-0 top-0 rounded-pill"
              :style="{ width: `${volumePercent}%` }"
            />
            <view
              v-if="!volumeOffline && !isQuiet"
              class="vol-knob absolute rounded-full bg-white"
              :style="{ left: `${volumePercent}%` }"
            />
          </view>
          <text class="vol-hint block" :class="volumeOffline ? 'text-muted' : 'text-secondary'">{{ volumeHint }}</text>
        </view>

        <!-- 今日事件卡片 -->
        <view class="card bg-card rounded-lg">
          <view class="flex items-center justify-between">
            <text class="card__title text-main font-bold">今日事件</text>
            <view class="flex items-center gap-1" @tap="goHistory">
              <text class="events-more text-secondary">查看全部</text>
              <image class="events-more__arrow" :src="getIcon('chevron-right', '#8C8578')" mode="aspectFit" />
            </view>
          </view>
          <view v-if="events.length > 0" class="flex flex-col gap-3 mt-4">
            <view v-for="e in events" :key="e.key" class="flex items-center gap-3">
              <view class="event-chip rounded-full flex items-center justify-center shrink-0" :style="{ background: e.chipBg }">
                <image class="event-chip__icon" :src="getIcon(e.icon, e.color)" mode="aspectFit" />
              </view>
              <text class="event-row flex-1 text-main">
                {{ e.title }}
                <text class="text-secondary"> · {{ e.detail }}</text>
              </text>
              <text class="event-time text-muted shrink-0">{{ e.timeText }}</text>
            </view>
          </view>
          <text v-else class="events-empty text-secondary">今日暂无事件</text>
        </view>

        <!-- 操作按钮：监听 / 静音提醒 -->
        <view class="actions flex gap-3">
          <view class="action-btn action-btn--listen rounded-pill flex items-center justify-center gap-2" @tap="onListen">
            <image class="action-btn__icon" :src="getIcon('mic', '#ffffff')" mode="aspectFit" />
            <text class="action-btn__text text-white">监听</text>
          </view>
          <view
            class="action-btn rounded-pill flex items-center justify-center gap-2"
            :class="muted ? 'action-btn--muted' : 'action-btn--plain bg-card'"
            @tap="toggleMute"
          >
            <image
              class="action-btn__icon"
              :src="getIcon('bell-off', muted ? '#D96A5B' : '#3B362E')"
              mode="aspectFit"
            />
            <text class="action-btn__text" :class="muted ? 'text-coral' : 'text-main'">静音提醒</text>
          </view>
        </view>
      </template>
    </view>

    <!-- 自定义底部导航（设计稿样式） -->
    <CustomTabBar current="home" />
  </view>
</template>

<style lang="scss">
/* 小程序根元素 — 100vh 在小程序中不准确，用 100% 继承 */
page {
  height: 100%;
}
</style>

<style lang="scss" scoped>
/* ------------------------------------------------------------------ */
/*  页面骨架                                                            */
/* ------------------------------------------------------------------ */
.page {
  @include page-layout;
  box-sizing: border-box;
  padding: 1.25rem; // 基础页边距（设计稿屏幕左右边距 20px）
  padding-top: var(--status-bar-height); // 重新声明：简写会覆盖 mixin 的状态栏避让
}

.main {
  @include main-layout;
  padding-bottom: 200rpx; // 让位悬浮 TabBar（112rpx + 底部偏移 + 安全区）
}

/* ------------------------------------------------------------------ */
/*  头部                                                                */
/* ------------------------------------------------------------------ */
.header {
  padding: 22rpx 0 8rpx;

  &__greeting {
    font-size: 52rpx;
    letter-spacing: 1rpx;
  }
}

.bell {
  width: 72rpx;
  height: 72rpx;

  &__icon {
    width: 44rpx;
    height: 44rpx;
    margin: 14rpx;
  }

  &__dot {
    width: 14rpx;
    height: 14rpx;
    top: 12rpx;
    right: 12rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  卡片通用                                                            */
/* ------------------------------------------------------------------ */
.card {
  padding: 32rpx;
  box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);
}

.card--status {
  padding: 44rpx 32rpx 48rpx;
}

.card__title {
  font-size: 32rpx;
}

/* ------------------------------------------------------------------ */
/*  当前状态                                                            */
/* ------------------------------------------------------------------ */
.status-face {
  width: 200rpx;
  height: 200rpx;
}

.status-text {
  margin-top: 28rpx;
  font-size: 40rpx;
}

.status-duration {
  margin-top: 14rpx;
  font-size: 28rpx;
}

/* ------------------------------------------------------------------ */
/*  设备在线                                                            */
/* ------------------------------------------------------------------ */
.device-card {
  &__signal {
    width: 40rpx;
    height: 40rpx;
  }

  &__dot {
    width: 12rpx;
    height: 12rpx;
  }

  &__title {
    font-size: 30rpx;
    font-weight: 600;
  }

  &__sub {
    margin-top: 6rpx;
    font-size: 24rpx;
  }

  &__arrow {
    width: 32rpx;
    height: 32rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  实时音量                                                            */
/* ------------------------------------------------------------------ */
.volume-value {
  font-size: 36rpx;
}

.vol-track {
  margin-top: 28rpx;
  height: 20rpx; // 规范 10px
}

.vol-fill {
  height: 100%;
  background-color: $color-primary;
}

.vol-knob {
  width: 28rpx; // 14px
  height: 28rpx;
  top: 50%;
  border: 6rpx solid $color-primary; // 3px
  transform: translate(-50%, -50%);
  box-shadow: 0 1rpx 3rpx rgba(0, 0, 0, 0.15);
}

.vol-hint {
  margin-top: 16rpx;
  font-size: 24rpx;
}

/* ------------------------------------------------------------------ */
/*  今日事件                                                            */
/* ------------------------------------------------------------------ */
.events-more {
  font-size: 26rpx;

  &__arrow {
    width: 24rpx;
    height: 24rpx;
  }
}

.event-chip {
  width: 64rpx;
  height: 64rpx;

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }
}

.event-row {
  font-size: 28rpx;
}

.event-time {
  font-size: 26rpx;
}

.events-empty {
  margin-top: 24rpx;
  font-size: 26rpx;
}

/* ------------------------------------------------------------------ */
/*  操作按钮                                                            */
/* ------------------------------------------------------------------ */
.actions {
  margin-top: 8rpx;
}

.action-btn {
  flex: 1;
  height: 96rpx;

  &--listen {
    background-color: $color-primary;
  }

  &--plain {
    box-shadow: 0 4rpx 24rpx rgba(60, 50, 30, 0.04);
  }

  &--muted {
    background-color: $color-danger-soft;
  }

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }

  &__text {
    font-size: 30rpx;
    font-weight: 500;
  }
}

/* ------------------------------------------------------------------ */
/*  首次空态（设计稿 08）                                                */
/* ------------------------------------------------------------------ */
.empty-hero {
  gap: 16rpx;
  padding: 40rpx 0 24rpx;

  &__circle {
    width: 200rpx; // 104px
    height: 200rpx;
  }

  &__img {
    width: 120rpx;
    height: 120rpx;
  }

  &__title {
    margin-top: 16rpx;
    font-size: 37rpx; // 19px
  }

  &__desc {
    font-size: 25rpx; // 13px
  }
}

.btn-cta {
  height: 96rpx; // h50

  &__icon {
    width: 36rpx; // 18px
    height: 36rpx;
  }

  &__text {
    font-size: 29rpx;
    font-weight: 500;
  }
}

.help-link {
  margin-top: 20rpx;
  font-size: 25rpx;
}

.rights-card {
  &__title {
    font-size: 30rpx;
  }
}

.rights-row {
  &__text {
    font-size: 27rpx; // 14px
    font-weight: 500;
  }
}
</style>
