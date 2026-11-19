<route lang="json">
{ "layout": "tabbar", "type": "home" }
</route>

<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
import { onShow } from '@dcloudio/uni-app';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fetchBabyHistory } from '@/api/baby';
import { acceptFamilyInvite, joinFamily } from '@/api/family';
import { EVENT_META, QUIET_HINT, STATUS_META, toCardState, VOLUME_MAX_DB, VOLUME_MIN_DB, VOLUME_ZONES } from '@/constants/babyStatus';
import { CACHE_KEY } from '@/constants/cache';
import { colors } from '@/constants/colors';
import { useBabyMonitor } from '@/hooks/useBabyMonitor';
import { useBackToBackground } from '@/hooks/useBackToBackground';
import { useBatteryWhitelistPrompt } from '@/hooks/useBatteryWhitelistPrompt';
import { useCapsuleGap } from '@/hooks/useCapsuleGap';
import { fmtDateKey } from '@/utils/babyEvents';
import {
  familyErrorMessage,
  getFamilyMember,
  getFamilyOwner,
  getFamilyRole,
  parseJoinQr,
  saveFamilyMember,
} from '@/utils/family';
import { getIcon } from '@/utils/icons';
import { isValidServerUrl } from '@/utils/server';
import { hasLocalPairing, storage } from '@/utils/storage';

/* ------------------------------------------------------------------ */
/*  服务端数据                                                          */
/* ------------------------------------------------------------------ */

const { status, volume, device, durationSec, listening, refresh, reconnect, sendCmd } = useBabyMonitor();

/* ------------------------------------------------------------------ */
/*  本地数据                                                            */
/* ------------------------------------------------------------------ */

const greeting = ref<string>('晚上好');
const userName = ref<string>('Sheldon');
const muted = ref<boolean>(false);

/* ------------------------------------------------------------------ */
/*  设备离线态（设计稿 07 / 规范 12.1）                                   */
/* ------------------------------------------------------------------ */

const isDeviceOffline = computed(() => !status.value.isOnline);
/** App 只能观察设备重连，无法触达离线设备 —— 「已尝试 N 次」按设备 3s 重连节奏本地计数 */
const offlineAttempts = ref(0);
const lastOnlineAt = ref<number | null>(null);
const nowTick = ref(Date.now());
let offlineTimer: ReturnType<typeof setInterval> | null = null;

const offlineBannerText = computed(() =>
  offlineAttempts.value >= 5 ? '重连失败，请检查设备电源与网络' : '设备已离线，正在自动重连…',
);

const offlineMinutesText = computed(() => {
  if (!lastOnlineAt.value)
    return '时间未知';
  const min = Math.max(1, Math.floor((nowTick.value - lastOnlineAt.value) / 60000));
  return `${min} 分钟前`;
});

function manualReconnect() {
  // 真正的重连由设备侧执行，这里立即拉取一次状态并重置计数
  offlineAttempts.value = 0;
  refresh();
}

watch(isDeviceOffline, (offline, old) => {
  if (offline) {
    if (old === false)
      lastOnlineAt.value = Date.now();
    // 计数节奏对齐设备重连间隔，同时驱动「X 分钟前」刷新
    offlineTimer = setInterval(() => {
      offlineAttempts.value++;
      nowTick.value = Date.now();
    }, 3000);
  }
  else if (offlineTimer) {
    // 重连成功 → 无动画回正常首页（规范 12.1）
    clearInterval(offlineTimer);
    offlineTimer = null;
    offlineAttempts.value = 0;
  }
}, { immediate: true });
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
  volumeOffline.value ? colors.muted : zone.value.color,
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
  /** 事件时间戳（噪声事件与状态切换事件归并排序用） */
  ts: number;
}

const events = ref<BabyEvent[]>([]);
/** 今日最新事件时间戳（铃铛红点未读判定基准，规范 S-06） */
const lastEventTs = ref(0);
/** 红点未读：今日最新事件时间戳 > 最近一次已读时刻（铃铛点击后清零） */
const bellReadAt = ref<number>(Number(uni.getStorageSync(CACHE_KEY.BELL_READ_AT) || 0));
const hasUnreadBell = computed(() => hasPairedDevice.value && lastEventTs.value > bellReadAt.value);

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadEvents() {
  fetchBabyHistory()
    .then(({ items, events: noiseEvents }) => {
      lastEventTs.value = items[0]?.time ?? 0;
      const todayStart = new Date().setHours(0, 0, 0, 0);
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
          ts: cur.time,
        });
      }
      // 事件层「有动静」（规范 T-07）：与状态切换事件按时间归并，单条呈现
      const noiseMeta = EVENT_META.noise;
      for (const e of noiseEvents ?? []) {
        if (e.time < todayStart)
          continue;
        list.push({
          key: `noise-${e.time}`,
          icon: noiseMeta.icon,
          color: noiseMeta.color,
          chipBg: noiseMeta.chipBg,
          title: noiseMeta.title,
          detail: '翻身声检测',
          timeText: formatTime(e.time),
          ts: e.time,
        });
      }
      list.sort((a, b) => b.ts - a.ts);
      events.value = list.slice(0, 3);
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
  // 规范 L-06：状态卡计时恒为 h:mm:ss（设计稿 01「已持续 1:23:45」）
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
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

/** 铃铛（规范 S-06）：点击 → 历史页当日，红点清零（新事件会重新点亮） */
function onBellTap() {
  bellReadAt.value = Date.now();
  storage.set(CACHE_KEY.BELL_READ_AT, bellReadAt.value);
  // 联动历史页「当日」：复用统计下钻的日期定位机制
  storage.set(CACHE_KEY.STATS_DRILL_DATE, fmtDateKey(Date.now()));
  goHistory();
}

function onListenTap() {
  // 监听 = 设备端持久偏好 (2026-11-19 语义): 开关写设备 NVS, 不随 App 在线
  // 启停, 状态以 listenState 回执为准。关闭监护会停掉哭声识别与提醒推送,
  // 二次确认防误触
  if (!device.value.isOnline) {
    uni.showToast({ title: '设备离线，恢复后按设备开关状态继续', icon: 'none' });
    return;
  }
  if (listening.value) {
    uni.showModal({
      title: '关闭监护',
      content: '关闭后设备不再识别哭声，也不会推送提醒。确定关闭？',
      confirmText: '关闭监护',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm)
          sendCmd('listen_off');
      },
    });
    return;
  }
  sendCmd('listen_on');
  uni.showToast({ title: '监护已开启', icon: 'none' });
}

// （监听态随设备离线自动退出，已移入 useBabyMonitor 的 offline watch）

function toggleMute() {
  if (isDeviceOffline.value)
    return; // 离线禁用（规范 12.1 快捷操作变体）
  muted.value = !muted.value;
  uni.showToast({ title: muted.value ? '已静音提醒' : '已恢复提醒', icon: 'none' });
}

function goPairing() {
  uni.navigateTo({ url: '/pages/pairing/index' });
}

/* ------------------------------------------------------------------ */
/*  家庭共享：家人手机加入（CR-01 成员制）                               */
/*  扫码免确认 join / 受邀 accept（需确认）；payload 定义见 utils/family  */
/* ------------------------------------------------------------------ */

/** 本机是否家庭成员：监听等设备控制入口对成员隐藏（P-02 只读） */
const isMember = ref(false);

function onJoinTap() {
  // #ifdef APP-PLUS
  // 扫码/手填双入口：扫码最简（免确认），手填走 地址→邀请码→称呼 三步
  uni.showActionSheet({
    itemList: ['扫码二维码加入', '手动输入加入信息'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        uni.scanCode({
          onlyFromCamera: false,
          success: ({ result }) => handleJoinPayload(result),
        });
      }
      else {
        promptManualJoin();
      }
    },
  });
  // #endif
  // #ifndef APP-PLUS
  promptManualJoin();
  // #endif
}

/** 手动输入：地址 → 邀请码 → 称呼（邀请码/加入码见家人的分享页） */
function promptManualJoin() {
  uni.showModal({
    title: '加入家庭监护',
    editable: true,
    placeholderText: '粘贴服务器地址，如 ws://192.168.1.100:3001/ws',
    success: ({ confirm, content }) => {
      if (!confirm)
        return;
      const server = (content || '').trim();
      if (!isValidServerUrl(server)) {
        uni.showToast({ title: '地址应以 ws:// 或 wss:// 开头', icon: 'none' });
        return;
      }
      uni.showModal({
        title: '输入邀请码',
        editable: true,
        placeholderText: '6 位加入码，见家人的分享页',
        success: ({ confirm: ok, content: code }) => {
          if (!ok)
            return;
          const joined = (code || '').trim().toUpperCase();
          if (!joined) {
            uni.showToast({ title: '请输入加入码', icon: 'none' });
            return;
          }
          promptJoinName(server, joined);
        },
      });
    },
  });
}

/** 扫码入口：解析新 payload（join 免确认 / invite 需确认）；旧地址码已升级 */
function handleJoinPayload(raw: string) {
  const parsed = parseJoinQr(raw);
  if (parsed.kind === 'invalid') {
    uni.showToast({ title: '无法识别的二维码', icon: 'none' });
    return;
  }
  if (parsed.kind === 'legacy') {
    uni.showToast({ title: '二维码格式已升级，请让家人重新生成', icon: 'none' });
    return;
  }
  if (getFamilyMember()) {
    uni.showToast({ title: '已是家庭成员，退出共享后才能换绑', icon: 'none' });
    return;
  }
  if (parsed.kind === 'join') {
    promptJoinName(parsed.server, parsed.code);
  }
  else {
    confirmInviteJoin(parsed);
  }
}

/** 免确认加入：填称呼（成员列表展示用）→ 注册 → 落地成功页 */
function promptJoinName(server: string, code: string) {
  uni.showModal({
    title: '加入家庭共享',
    editable: true,
    placeholderText: '怎么称呼你（如：妈妈）',
    success: ({ confirm, content }) => {
      if (!confirm)
        return;
      const name = (content || '').trim();
      if (!name) {
        uni.showToast({ title: '请输入称呼', icon: 'none' });
        return;
      }
      joinAsMember(server, code, name);
    },
  });
}

/** 受邀加入（板④未出确认 UI，取通用确认弹框）：邀请码自带称呼，无需再填 */
function confirmInviteJoin(parsed: { server: string; code: string; name?: string }) {
  uni.showModal({
    title: '接受邀请',
    content: `接受${parsed.name ? `「${parsed.name}」的` : ''}邀请，加入家庭共享？加入后仅可只读查看`,
    confirmText: '接受',
    success: ({ confirm }) => {
      if (!confirm)
        return;
      joinAsMember(parsed.server, parsed.code);
    },
  });
}

/** 统一落地：server 注册成员 → 写本机身份与配对记录 → 成功页（板④） */
function joinAsMember(server: string, code: string, name?: string) {
  const request = name
    ? joinFamily(server, code, name)
    : acceptFamilyInvite(server, code);
  request.then((result) => {
    saveFamilyMember({
      token: result.token,
      id: result.member.id,
      name: result.member.name,
      joinedAt: result.member.joinedAt,
    });
    storage.set(CACHE_KEY.PAIRED_SERVER_URL, server);
    // 设备真名待 server 设备注册表（v1.2）落地后由 /api/device 回填
    storage.set(CACHE_KEY.PAIRED_DEVICE, { name: '宝宝监护器' });
    hasPairedDevice.value = true;
    greeting.value = buildGreeting();
    reconnect();
    uni.navigateTo({ url: '/pages/family-join-success/index' });
  }).catch((e) => {
    uni.showToast({ title: familyErrorMessage(e), icon: 'none' });
  });
}

function onHelpTap() {
  uni.showToast({ title: '帮助中心开发中', icon: 'none' });
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/index' });
}

/** 「查看全部」→ 历史页当日（规范 S-06）：复用统计下钻的日期定位机制 */
function goHistoryToday() {
  storage.set(CACHE_KEY.STATS_DRILL_DATE, fmtDateKey(Date.now()));
  goHistory();
}

function goSettings() {
  uni.switchTab({ url: '/pages/settings/index' });
}

/** 设备信息卡入口（规范 5.5）：在线 → 设备详情页；离线无 chevron，仍去设置页 */
function goDeviceDetail() {
  if (isDeviceOffline.value) {
    goSettings();
    return;
  }
  uni.navigateTo({ url: '/pages/device-detail/index' });
}

/* ------------------------------------------------------------------ */
/*  生命周期                                                            */
/* ------------------------------------------------------------------ */

onMounted(() => {
  loadEvents();
  eventTimer = setInterval(loadEvents, 30_000);
});

// 返回键拦截（仅 Android 硬件返回键触发）：后台保活开启时把任务退到后台而非
// 退出 App——默认返回会 finish 主 Activity，webview/JS 随之死亡，前台服务也
// 保不住 WebSocket。保活关闭时不拦截，行为与从前一致
useBackToBackground();

// 电池优化白名单首次自动引导（一次性；未豁免时这是后台存活率的最大杠杆）
useBatteryWhitelistPrompt();

// 空态判定放 onShow：从配对页 navigateBack 返回时页面不会重新 mounted，
// 每次可见时重读配对标记，才能从空态切回正常态
onShow(() => {
  hasPairedDevice.value = hasLocalPairing();
  greeting.value = hasPairedDevice.value ? buildGreeting() : '你好'; // 空态无设备语境（规范 12.2）
  // 家庭角色与称呼：成员加入/退出后回到首页即刷新
  isMember.value = getFamilyRole() === 'member';
  userName.value = getFamilyMember()?.name || getFamilyOwner()?.name || 'Sheldon';
});

onBeforeUnmount(() => {
  if (eventTimer) {
    clearInterval(eventTimer);
    eventTimer = null;
  }
  if (offlineTimer) {
    clearInterval(offlineTimer);
    offlineTimer = null;
  }
});
</script>

<template>
  <view class="page h-full">
    <!-- ============== 主体内容 ============== -->
    <view class="main gap-3" :class="{ 'main--listening': listening }">
      <!-- 头部：问候语 + 通知铃铛（吸顶；胶囊避让必须留在本元素上，吸顶后才不钻到胶囊底下） -->
      <view class="header sticky-top flex items-center justify-between" :style="capsuleTopGap ? { paddingTop: `${capsuleTopGap}px` } : undefined">
        <text class="header__greeting text-main font-bold">{{ greeting }}，{{ userName }}</text>
        <view class="flex items-center gap-3">
          <!-- 静音态徽章（设计稿 20）：header 琥珀胶囊提示当前静音中 -->
          <view v-if="muted && !isDeviceOffline" class="mute-badge rounded-pill">
            静音中
          </view>
          <view class="bell relative" @tap="onBellTap">
            <image class="bell__icon" :src="getIcon('bell', 'ink')" mode="aspectFit" />
            <view v-if="hasUnreadBell" class="bell__dot rounded-full bg-coral absolute" />
          </view>
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

        <AppButton size="cta" @tap="goPairing">
          <image class="btn-cta__icon" :src="getIcon('bluetooth', 'white')" mode="aspectFit" />
          去配对设备
        </AppButton>
        <AppButton size="cta" variant="secondary" @tap="onJoinTap">
          <image class="btn-cta__icon" :src="getIcon('scan', 'ink')" mode="aspectFit" />
          加入家庭监护
        </AppButton>
        <text class="help-link text-secondary block text-center" @tap="onHelpTap">如何配对？查看教程</text>

        <view class="card rights-card bg-card rounded-lg mt-6">
          <text class="card__title text-main font-bold">连接后你将获得</text>
          <view class="rights-row flex items-center gap-3 mt-4">
            <view class="event-chip rounded-full bg-primary-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('mic', 'primary')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">实时音量监测与三段告警</text>
          </view>
          <view class="rights-row flex items-center gap-3 mt-3">
            <view class="event-chip rounded-full bg-danger-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('droplet', 'danger')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">哭声识别，立即推送到手机</text>
          </view>
          <view class="rights-row flex items-center gap-3 mt-3">
            <view class="event-chip rounded-full bg-amber-soft flex items-center justify-center shrink-0">
              <image class="event-chip__icon" :src="getIcon('moon', 'amber')" mode="aspectFit" />
            </view>
            <text class="rights-row__text text-main">睡眠记录与每日回顾</text>
          </view>
        </view>
      </template>

      <!-- ========= 正常主页 ========= -->
      <template v-else>
        <!-- 离线提示条（规范 12.1）：问候行下方 -->
        <view v-if="isDeviceOffline" class="offline-banner rounded-lg flex items-center">
          <image class="offline-banner__icon" :src="getIcon('wifi-off', 'amberInk')" mode="aspectFit" />
          <text class="offline-banner__text">{{ offlineBannerText }}</text>
          <image class="offline-banner__spinner" :src="getIcon('spinner', 'amberInk')" mode="aspectFit" />
        </view>

        <!-- 当前状态卡片 -->
        <view class="card card--status bg-card rounded-lg flex flex-col items-center" :class="{ 'card--status--listening': listening }">
          <image
            class="status-face"
            :src="isDeviceOffline ? '/static/icons/face-sleep-offline.svg' : meta.face"
            mode="aspectFit"
          />
          <text class="status-text font-bold" :style="{ color: isDeviceOffline ? colors.warmGray : meta.color }">
            {{ isDeviceOffline ? '设备离线' : meta.text }}
          </text>
          <text class="status-duration" :class="isDeviceOffline ? 'text-muted' : 'text-secondary'">
            {{ isDeviceOffline ? `自动重连中 · 已尝试 ${offlineAttempts} 次` : `已持续 ${durationText}` }}
          </text>
        </view>

        <!-- 设备在线卡片（规范 5.5：右侧 chevron → 设备详情页） -->
        <view class="card bg-card rounded-lg flex items-center" @tap="goDeviceDetail">
          <image
            class="device-card__signal"
            :src="getIcon(isDeviceOffline ? 'wifi-off' : 'wifi-signal', isDeviceOffline ? 'empty' : 'primary')"
            mode="aspectFit"
          />
          <view class="flex-1 ml-3">
            <view class="flex items-center gap-2">
              <view class="device-card__dot rounded-full" :class="isDeviceOffline ? 'bg-card-soft' : 'bg-primary'" />
              <text class="device-card__title text-main">{{ isDeviceOffline ? '设备离线' : '设备在线' }}</text>
            </view>
            <text class="device-card__sub text-secondary block">
              {{ isDeviceOffline ? `上次在线 · ${offlineMinutesText}` : device.connectionText }}
            </text>
          </view>
          <!-- 手动重连按钮 88×32 r16（规范 12.1） -->
          <view v-if="isDeviceOffline" class="reconnect-btn rounded-pill flex items-center justify-center" @tap.stop="manualReconnect">
            <text class="reconnect-btn__text">重新连接</text>
          </view>
          <image v-else class="device-card__arrow" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
        </view>

        <!-- 实时音量卡片 -->
        <view class="card bg-card rounded-lg">
          <view class="flex items-center justify-between">
            <view class="flex items-center gap-2">
              <text class="card__title text-main font-bold">实时音量</text>
              <!-- 监听中徽章（规范 12.3）：64×20，绿点 1s 闪烁 -->
              <view v-if="listening" class="live-badge rounded-pill flex items-center justify-center">
                <view class="live-badge__dot rounded-full" />
                <text class="live-badge__text">监听中</text>
              </view>
            </view>
            <text class="volume-value font-bold" :style="{ color: volumeValueColor }">{{ volumeDisplay }}</text>
          </view>
          <view class="vol-track relative">
            <!-- 离线禁用变体（规范 12.1）：整条灰轨，无分区/填充/游标 -->
            <view v-if="!volumeOffline" class="vol-zones flex h-full overflow-hidden rounded-pill">
              <view
                v-for="(z, i) in VOLUME_ZONES"
                :key="i"
                class="h-full"
                :style="{ background: z.soft, flexBasis: zoneWidth(i) }"
              />
            </view>
            <view v-else class="h-full w-full vol-track--offline" />
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
          <!-- 监听偏好持久化 (2026-11-19)：原文案「正在通过手机扬声器播放宝宝的声音」
               描述的播放路由尚未落地，改为真实状态；「远程听声」上线后恢复播放
               路由文案（规范 12.3） -->
          <text v-if="listening" class="vol-live-hint block">设备端持续识别哭声中，触发将推送提醒</text>
          <text v-else class="vol-live-hint block">监护已关闭，设备不识别哭声，点下方按钮开启</text>
        </view>

        <!-- 今日事件卡片 -->
        <view class="card bg-card rounded-lg">
          <view class="flex items-center justify-between">
            <text class="card__title font-bold" :class="isDeviceOffline ? 'text-muted' : 'text-main'">今日事件</text>
            <text v-if="isDeviceOffline" class="events-sync text-muted">重连后同步</text>
            <view v-else class="flex items-center gap-1" @tap="goHistoryToday">
              <text class="events-more text-secondary">查看全部</text>
              <image class="events-more__arrow" :src="getIcon('chevron-right', 'secondary')" mode="aspectFit" />
            </view>
          </view>
          <!-- 离线禁用变体（规范 12.1）：单行空态 -->
          <view v-if="isDeviceOffline" class="events-offline flex items-center">
            <image class="events-offline__icon" :src="getIcon('clock', 'empty')" mode="aspectFit" />
            <text class="events-offline__text text-muted">离线期间暂无实时数据，重连后自动恢复</text>
          </view>
          <view v-else-if="events.length > 0" class="flex flex-col gap-3 mt-4">
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

        <!-- 操作按钮：监听 / 静音提醒（离线禁用变体，规范 12.1）；
             监听是设备控制，成员端隐藏（P-02 只读，server 也会拒绝成员 cmd） -->
        <view class="actions flex gap-3">
          <view
            v-if="!isMember"
            class="action-btn action-btn--listen rounded-pill flex items-center justify-center gap-2"
            :class="{ 'action-btn--disabled': isDeviceOffline }"
            @tap="onListenTap"
          >
            <image class="action-btn__icon" :src="getIcon('mic', 'white')" mode="aspectFit" />
            <text class="action-btn__text text-white">{{ listening ? '监护中' : '监护已关闭' }}</text>
          </view>
          <view
            class="action-btn rounded-pill flex items-center justify-center gap-2"
            :class="isDeviceOffline ? 'action-btn--disabled' : (muted ? 'action-btn--muted-on' : 'action-btn--plain bg-card')"
            @tap="toggleMute"
          >
            <image
              class="action-btn__icon"
              :src="getIcon('bell-off', muted ? 'white' : (isDeviceOffline ? 'disabled' : 'ink'))"
              mode="aspectFit"
            />
            <!-- 静音态（设计稿 20）：绿底白字「静音中」，非旧版浅红方案 -->
            <text class="action-btn__text" :class="muted ? 'text-white' : 'text-main'">{{ muted ? '静音中' : '静音提醒' }}</text>
          </view>
        </view>
      </template>
    </view>

    <!-- 底部导航由 layouts/tabbar.vue 布局统一挂载 -->
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
  padding-top: 0; // 状态栏避让移入吸顶 .header 自身（滚动吸顶后由它的不透明背景盖住状态栏区域）
}

.main {
  @include main-layout;
  padding-bottom: 200rpx; // 让位悬浮 TabBar（112rpx + 底部偏移 + 安全区）
}

.main--listening {
  // 规范 12.3 间距例外：监听态区块间距 12（=24rpx，与常态 gap-3 当前值一致）。
  // 显式固定，防止未来常态间距调大后监听态音量卡增高导致底部快捷操作溢出
  gap: 24rpx;
}

/* ------------------------------------------------------------------ */
/*  头部                                                                */
/* ------------------------------------------------------------------ */
.header {
  // 吸顶（.sticky-top 原子类）：页面在 .page 内滚动，问候语头部固定不随内容滚走。
  // 状态栏避让放进自身 padding，吸顶后不透明背景盖住状态栏区域（小程序端胶囊避让
  // 仍由模板内联 paddingTop 覆盖本值）
  padding: calc(var(--status-bar-height) + 22rpx) 0 8rpx;

  &__greeting {
    font-size: 52rpx;
    letter-spacing: 1rpx;
  }
}

/* 静音态徽章（设计稿 20）：header 琥珀胶囊 */
.mute-badge {
  padding: 8rpx 20rpx;
  background-color: $color-amber-soft;
  font-size: 22rpx;
  font-weight: 500;
  color: $color-amber-ink;
}

/* 离线提示条（规范 12.1）：琥珀底 r12 */
.offline-banner {
  gap: 12rpx;
  padding: 20rpx 24rpx;
  background-color: $color-amber-soft;

  &__icon {
    width: 32rpx; // 16px
    height: 32rpx;
  }

  &__text {
    font-size: 24rpx; // 12px
    font-weight: 500;
    color: $color-amber-ink;
  }

  &__spinner {
    width: 28rpx;
    height: 28rpx;
    margin-left: auto; // 文字后小 spinner（规范 13.1 P1）
    animation: banner-spin 1s linear infinite;
  }
}

@keyframes banner-spin {
  to { transform: rotate(360deg); }
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
  box-shadow: $shadow-card;
}

.card--status {
  padding: 44rpx 32rpx 48rpx;
}

.card--status--listening {
  // 规范 12.3：监听态状态卡上下边距 14/12
  padding: 28rpx 32rpx 24rpx;
}

.card__title {
  font-size: 32rpx;
}

/* 监听中徽章（规范 12.3）：64×20 r10 浅绿底，绿点 6px 1s 闪烁（规范 13.1 P0） */
.live-badge {
  gap: 8rpx;
  width: 128rpx;
  height: 40rpx;
  background-color: $color-primary-soft;

  &__dot {
    width: 12rpx;
    height: 12rpx;
    background-color: $color-primary-deep;
    animation: live-blink 1s ease infinite;
  }

  &__text {
    font-size: 20rpx;
    font-weight: 600;
    color: $color-primary-deep;
    line-height: 1;
  }
}

@keyframes live-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
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

/* 手动重连按钮（规范 12.1）：88×32 r16 琥珀底 */
.reconnect-btn {
  width: 176rpx;
  height: 64rpx;
  border-radius: 32rpx;
  background-color: $color-amber-soft;
  flex-shrink: 0;

  &__text {
    font-size: 24rpx;
    font-weight: 500;
    color: $color-amber-ink;
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

.vol-track--offline {
  background-color: $color-card-soft; // 离线禁用变体：整条灰轨（规范 12.1）
}

.vol-hint {
  margin-top: 16rpx;
  font-size: 24rpx;
}

.vol-live-hint {
  margin-top: 8rpx;
  font-size: 22rpx; // 11px
  color: $color-text-muted;
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

.events-sync {
  font-size: 24rpx; // 12px：离线变体右上角「重连后同步」（规范 12.1）
}

.events-offline {
  margin-top: 24rpx;
  gap: 16rpx;

  &__icon {
    width: 72rpx; // 36px 时钟
    height: 72rpx;
  }

  &__text {
    font-size: 26rpx; // 13px
  }
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
    box-shadow: $shadow-card;
  }

  // 静音态（设计稿 20）：绿底白字「静音中」，与监听按钮同为实底绿
  &--muted-on {
    background-color: $color-primary;
  }

  &--disabled {
    // 离线禁用变体（规范 12.1）：中性底 + 禁用色图标文字，不可点
    background-color: $color-card-soft;

    .action-btn__text {
      color: $color-disabled;
    }
  }

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }

  &__stop {
    width: 24rpx; // 12×12 白色方形停止符（规范 12.3）
    height: 24rpx;
    background-color: $color-white;
    border-radius: 4rpx;
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

/* CTA 图标（按钮本体为共享组件 AppButton） */
.btn-cta__icon {
  width: 36rpx; // 18px
  height: 36rpx;
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
