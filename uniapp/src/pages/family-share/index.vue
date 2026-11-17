<script setup lang="ts">
/**
 * 分享给家人（设计板 19 系列 / 设计定义补全 P-08、S-07）
 *
 * owner 形态：成员列表（所有者/只读徽章、待确认可撤销）+ 扫码加入二维码
 * （5 分钟有效，免确认）+「分享二维码」+「邀请」入口（需对方确认，24h）。
 * member 形态：只读列表 + 底部「退出家庭共享」。
 * 首次进入（已配对且无家庭身份）引导所有者认领，先到先得。
 */
import type { FamilyInviteData, FamilyMemberData, FamilyOverviewData, JoinCodeData } from '@/api/family';
import { onShow } from '@dcloudio/uni-app';
import UQRCode from 'uqrcodejs';
import { computed, getCurrentInstance, nextTick, ref } from 'vue';
import { fetchBabyStatus } from '@/api/baby';
import {
  claimFamily,
  createFamilyInvite,
  fetchFamilyOverview,
  fetchJoinCode,
  removeFamilyMember,
  revokeFamilyInvite,
} from '@/api/family';
import { colors } from '@/constants/colors';
import {
  avatarInitial,
  buildJoinQrPayload,
  clearFamilyIdentity,
  familyErrorMessage,
  formatJoinedAt,
  genLocalToken,
  getFamilyMember,
  getFamilyOwner,
  getFamilyRole,
  saveFamilyOwner,
} from '@/utils/family';
import { getIcon } from '@/utils/icons';
import { resolveServerUrl } from '@/utils/server';
import { hasLocalPairing } from '@/utils/storage';

/* ------------------------------------------------------------------ */
/*  状态                                                                */
/* ------------------------------------------------------------------ */

const QR_SIZE = 200; // px，须与 canvas 宽高一致
const INVITE_QR_SIZE = 160;

const instance = getCurrentInstance()?.proxy;

const role = ref<'owner' | 'member' | 'none'>('none');
const overview = ref<FamilyOverviewData | null>(null);
const joinCode = ref<JoinCodeData | null>(null);
const ownerConnected = ref(true);
const serverUrl = ref('');

/** 待移除成员（自定义确认弹框，板⑤） */
const removeTarget = ref<FamilyMemberData | null>(null);
/** 新建邀请（弹框展示邀请码 + 邀请二维码，带外交付） */
const invite = ref<FamilyInviteData | null>(null);

let codeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const pendingCount = computed(() => overview.value?.invites?.length ?? 0);

function toast(title: string) {
  uni.showToast({ title, icon: 'none' });
}

/* ------------------------------------------------------------------ */
/*  进入与认领                                                          */
/* ------------------------------------------------------------------ */

onShow(() => {
  serverUrl.value = resolveServerUrl();
  if (!hasLocalPairing()) {
    toast('请先配对设备');
    setTimeout(() => uni.navigateBack(), 600);
    return;
  }
  role.value = getFamilyRole();
  if (role.value === 'none') {
    claimAsOwner();
  }
  else {
    refreshAll();
  }
});

/** 首次进入：本机生成凭证向 server 认领所有者（先到先得，重复认领幂等） */
function claimAsOwner() {
  uni.showModal({
    title: '认领家庭共享',
    editable: true,
    placeholderText: '你的称呼（如：Sheldon）',
    content: getFamilyOwner()?.name || '',
    success: ({ confirm, content }) => {
      if (!confirm) {
        uni.navigateBack();
        return;
      }
      const name = (content || '').trim() || '所有者';
      const token = genLocalToken();
      claimFamily(token, name).then(() => {
        saveFamilyOwner({ token, name });
        role.value = 'owner';
        refreshAll();
        toast('认领成功');
      }).catch((e) => {
        toast(familyErrorMessage(e));
        uni.navigateBack();
      });
    },
  });
}

function refreshAll() {
  fetchFamilyOverview().then((data) => {
    overview.value = data;
  }).catch(e => toast(familyErrorMessage(e)));

  fetchBabyStatus().then((s) => {
    ownerConnected.value = s.isOnline;
  }).catch(() => {});

  if (role.value === 'owner') {
    refreshJoinCode();
  }
}

function refreshJoinCode() {
  fetchJoinCode().then((data) => {
    joinCode.value = data;
    scheduleCodeRefresh(data);
    // 等 v-if 的 canvas 完成首帧布局后再绘制（与旧分享弹框同配方）
    nextTick(() => setTimeout(drawJoinQr, 60));
  }).catch(e => toast(familyErrorMessage(e)));
}

/** 有效期结束后静默换新码（页面停留时二维码始终可用） */
function scheduleCodeRefresh(data: JoinCodeData) {
  if (codeRefreshTimer)
    clearTimeout(codeRefreshTimer);
  const remain = data.expiresAt - Date.now();
  if (remain <= 0) {
    refreshJoinCode();
    return;
  }
  codeRefreshTimer = setTimeout(refreshJoinCode, remain + 500);
}

/* ------------------------------------------------------------------ */
/*  二维码绘制                                                          */
/* ------------------------------------------------------------------ */

function drawQr(canvasId: string, content: string, size: number) {
  try {
    const qr = new UQRCode();
    qr.data = content;
    qr.size = size;
    qr.make();
    qr.canvasContext = uni.createCanvasContext(canvasId, instance);
    qr.drawCanvas();
  }
  catch (e) {
    console.warn('[FamilyQR] draw failed', e);
  }
}

function drawJoinQr() {
  if (!joinCode.value || !serverUrl.value)
    return;
  const content = buildJoinQrPayload({ kind: 'join', server: serverUrl.value, code: joinCode.value.code });
  drawQr('joinQrCanvas', content, QR_SIZE);
}

function drawInviteQr() {
  if (!invite.value || !serverUrl.value)
    return;
  const content = buildJoinQrPayload({
    kind: 'invite',
    server: serverUrl.value,
    code: invite.value.code,
    name: invite.value.name,
  });
  drawQr('inviteQrCanvas', content, INVITE_QR_SIZE);
}

/* ------------------------------------------------------------------ */
/*  邀请（需对方确认）                                                   */
/* ------------------------------------------------------------------ */

function onInviteTap() {
  uni.showModal({
    title: '邀请家人',
    editable: true,
    placeholderText: '怎么称呼 TA（如：爸爸）',
    success: ({ confirm, content }) => {
      if (!confirm)
        return;
      const name = (content || '').trim();
      if (!name) {
        toast('请输入称呼');
        return;
      }
      createFamilyInvite(name).then((data) => {
        invite.value = data;
        refreshAll();
        nextTick(() => setTimeout(drawInviteQr, 60));
      }).catch((e) => {
        toast(familyErrorMessage(e));
      });
    },
  });
}

function closeInviteModal() {
  invite.value = null;
}

/** 邀请文本（带外交付：微信发送/口头告知，家人在首页「加入家庭监护」手动输入） */
function inviteText(): string {
  if (!invite.value)
    return '';
  return `【宝宝监护】邀请你加入家庭共享
服务器地址：${serverUrl.value}
邀请码：${invite.value.code}
24 小时内有效。在 App 首页点「加入家庭监护」→ 手动输入，或扫码邀请二维码`;
}

function copyInviteText() {
  uni.setClipboardData({ data: inviteText() });
}

/* ------------------------------------------------------------------ */
/*  成员操作                                                            */
/* ------------------------------------------------------------------ */

/** 正式成员行（owner 形态）→ 移除确认（板⑤）；member 形态列表不可点 */
function onMemberTap(member: FamilyMemberData) {
  if (role.value !== 'owner')
    return;
  removeTarget.value = member;
}

function closeRemoveModal() {
  removeTarget.value = null;
}

function confirmRemove() {
  const target = removeTarget.value;
  if (!target)
    return;
  removeFamilyMember(target.id).then(() => {
    toast(`已移除 ${target.name}`);
    closeRemoveModal();
    refreshAll();
  }).catch((e) => {
    toast(familyErrorMessage(e));
    closeRemoveModal();
  });
}

/** 待确认行 → 撤销邀请（板④脚注） */
function onPendingTap(inv: FamilyInviteData) {
  uni.showModal({
    title: '撤销邀请',
    content: `撤销发给「${inv.name}」的待确认邀请？`,
    confirmText: '撤销',
    confirmColor: colors.danger,
    success: ({ confirm }) => {
      if (!confirm)
        return;
      revokeFamilyInvite(inv.id).then(() => {
        toast('已撤销邀请');
        refreshAll();
      }).catch((e) => {
        toast(familyErrorMessage(e));
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/*  分享二维码 CTA                                                      */
/* ------------------------------------------------------------------ */

function onShareQrTap() {
  if (!joinCode.value)
    return;
  const items = ['复制邀请内容'];
  // #ifdef APP-PLUS
  items.unshift('保存二维码到相册');
  // #endif
  uni.showActionSheet({
    itemList: items,
    success: ({ tapIndex }) => {
      const label = items[tapIndex];
      if (label === '复制邀请内容') {
        copyShareText();
      }
      else {
        saveQrToAlbum();
      }
    },
  });
}

/** 扫码加入文本（免确认路径，5 分钟有效） */
function copyShareText() {
  const text = `【宝宝监护】家庭共享加入码：${joinCode.value?.code}
服务器地址：${serverUrl.value}
二维码 5 分钟内有效，过期请让家人重新生成。在 App 首页点「加入家庭监护」扫码或手动输入即可（只读查看）`;
  uni.setClipboardData({ data: text });
}

function saveQrToAlbum() {
  uni.canvasToTempFilePath({
    canvasId: 'joinQrCanvas',
    success: ({ tempFilePath }) => {
      uni.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: () => toast('已保存到相册'),
        fail: () => toast('保存失败，可截图后分享'),
      });
    },
    fail: () => toast('生成图片失败，可复制邀请内容'),
  });
}

/* ------------------------------------------------------------------ */
/*  member 形态：退出共享（E-13 自助退出路径）                            */
/* ------------------------------------------------------------------ */

function onExitTap() {
  const me = getFamilyMember();
  if (!me)
    return;
  uni.showModal({
    title: '退出家庭共享',
    content: '退出后将立即失去查看与接收提醒的权限，历史数据不会删除；如需再查看，请让家人重新邀请。',
    confirmText: '退出',
    confirmColor: colors.danger,
    success: ({ confirm }) => {
      if (!confirm)
        return;
      removeFamilyMember(me.id).then(() => {
        clearFamilyIdentity();
        toast('已退出家庭共享');
        setTimeout(() => uni.switchTab({ url: '/pages/home/index' }), 600);
      }).catch((e) => {
        toast(familyErrorMessage(e));
      });
    },
  });
}

function goBack() {
  uni.navigateBack();
}
</script>

<template>
  <view class="page">
    <!-- 吸顶导航（板19）：返回 + 标题 + 邀请 -->
    <view class="navbar sticky-top flex items-center">
      <view class="navbar__back flex items-center justify-center" @tap="goBack">
        <image class="navbar__back-icon" :src="getIcon('chevron-left', 'ink')" mode="aspectFit" />
      </view>
      <text class="navbar__title text-main font-semibold">分享给家人</text>
      <text v-if="role === 'owner'" class="navbar__action font-medium" @tap="onInviteTap">邀请</text>
    </view>

    <view class="flex flex-col flex-1 gap-4">
      <text class="subtitle text-secondary block">最多 6 位家人可查看，成员仅可只读查看</text>

      <!-- ========= 家庭成员（板19：所有者 + 成员 + 待确认） ========= -->
      <view class="section">
        <text class="section__title text-main font-bold block">
          家庭成员 · {{ overview?.quota.used ?? 0 }}/{{ overview?.quota.max ?? 6 }}<template v-if="pendingCount > 0">（{{ pendingCount }} 位待确认）</template>
        </text>
        <view v-if="overview" class="group bg-card rounded-lg">
          <!-- 所有者行 -->
          <view class="row">
            <view class="avatar avatar--owner rounded-full flex items-center justify-center">
              <text class="avatar__letter">{{ avatarInitial(overview.ownerName || '我') }}</text>
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">{{ overview.ownerName || '我' }}</text>
              <text class="row-desc text-secondary block">所有者 · {{ ownerConnected ? '已连接' : '离线' }}</text>
            </view>
            <text class="badge badge--owner">所有者</text>
          </view>
          <!-- 成员行（owner 可点移除；member 只读） -->
          <view
            v-for="member in overview.members"
            :key="member.id"
            class="row"
            :hover-class="role === 'owner' ? 'row--hover' : 'none'"
            @tap="onMemberTap(member)"
          >
            <view class="avatar rounded-full flex items-center justify-center">
              <text class="avatar__letter">{{ avatarInitial(member.name) }}</text>
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">{{ member.name }}</text>
              <text class="row-desc text-secondary block">只读 · {{ formatJoinedAt(member.joinedAt) }}</text>
            </view>
            <image v-if="role === 'owner'" class="row-chevron" :src="getIcon('chevron-right', 'muted')" mode="aspectFit" />
          </view>
          <!-- 待确认行（owner）：点击撤销 -->
          <view
            v-for="inv in overview.invites"
            :key="inv.id"
            class="row"
            hover-class="row--hover"
            @tap="onPendingTap(inv)"
          >
            <view class="avatar avatar--pending rounded-full flex items-center justify-center">
              <text class="avatar__letter">{{ avatarInitial(inv.name) }}</text>
            </view>
            <view class="row-body flex-1">
              <text class="row-title text-main block">{{ inv.name }}</text>
              <text class="row-desc text-secondary block">已发出邀请 · 等待确认</text>
            </view>
            <text class="badge badge--pending">待确认</text>
          </view>
        </view>
      </view>

      <!-- ========= 扫码加入（板19，仅 owner） ========= -->
      <view v-if="role === 'owner' && serverUrl" class="section">
        <text class="section__title text-main font-bold block">扫码加入</text>
        <view class="qr-card bg-card rounded-lg flex flex-col items-center">
          <view class="qr-card__qr rounded-md">
            <canvas
              v-if="joinCode"
              id="joinQrCanvas"
              canvas-id="joinQrCanvas"
              class="qr-card__canvas"
              :style="{ width: `${QR_SIZE}px`, height: `${QR_SIZE}px` }"
            />
          </view>
          <text class="qr-card__title text-main font-semibold block">扫码加入，无需确认</text>
          <text class="qr-card__desc text-secondary block">二维码 5 分钟内有效 · 仅限家人</text>
          <text v-if="joinCode" class="qr-card__code text-muted block">手动输入加入码 {{ joinCode.code }}</text>
        </view>
        <AppButton size="cta" class="qr-cta" @tap="onShareQrTap">
          <image class="qr-cta__icon" :src="getIcon('scan', 'white')" mode="aspectFit" />
          分享二维码
        </AppButton>
      </view>

      <view class="flex flex-col footer">
        <text class="footnote text-secondary block">成员仅可查看实时状态、历史与统计</text>
        <text class="footnote text-secondary block">无法修改设备设置或管理其他成员</text>
        <text v-if="role === 'owner' && pendingCount > 0" class="footnote text-muted block">待确认邀请可点击成员行撤销</text>
      </view>

      <!-- member 形态：退出共享 -->
      <view v-if="role === 'member'" class="exit flex flex-col items-center">
        <AppButton variant="danger-outline" @tap="onExitTap">
          退出家庭共享
        </AppButton>
      </view>
    </view>

    <!-- ========= 移除成员确认（板⑤ 自定义弹框） ========= -->
    <view v-if="removeTarget" class="mask" @tap="closeRemoveModal">
      <view class="dialog" @tap.stop>
        <text class="dialog__title text-main block">移除 {{ removeTarget.name }}？</text>
        <text class="dialog__body text-secondary block">移除后该成员将立即失去查看与接收提醒的权限，历史数据不会删除</text>
        <AppButton variant="danger" class="dialog__btn" @tap="confirmRemove">
          移除
        </AppButton>
        <AppButton variant="secondary" class="dialog__btn" @tap="closeRemoveModal">
          取消
        </AppButton>
      </view>
    </view>

    <!-- ========= 邀请弹框（邀请码 + 邀请二维码，带外交付） ========= -->
    <view v-if="invite" class="mask" @tap="closeInviteModal">
      <view class="dialog dialog--invite" @tap.stop>
        <text class="dialog__title text-main block">邀请「{{ invite.name }}」</text>
        <text class="dialog__body text-secondary block">对方确认后即成为家庭成员，邀请 24 小时内有效</text>
        <view class="dialog__qr rounded-md">
          <canvas
            id="inviteQrCanvas"
            canvas-id="inviteQrCanvas"
            class="dialog__canvas"
            :style="{ width: `${INVITE_QR_SIZE}px`, height: `${INVITE_QR_SIZE}px` }"
          />
        </view>
        <text class="dialog__code text-main font-bold block">邀请码 {{ invite.code }}</text>
        <AppButton size="cta" class="dialog__btn" @tap="copyInviteText">
          复制邀请内容
        </AppButton>
        <text class="dialog__later text-muted" @tap="closeInviteModal">关闭</text>
      </view>
    </view>
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
  display: flex;
  flex-direction: column;
  padding: 1.25rem;
  padding-top: 0;
  min-height: 100vh;
  background-color: $color-bg;
}

/* ------------------------------------------------------------------ */
/*  导航（板19：右侧绿字「邀请」）                                       */
/* ------------------------------------------------------------------ */

.navbar {
  gap: 20rpx;
  padding: calc(var(--status-bar-height) + 32rpx) 0 20rpx;

  &__back {
    width: 56rpx;
    height: 56rpx;
  }

  &__back-icon {
    width: 40rpx;
    height: 40rpx;
  }

  &__title {
    font-size: 33rpx;
  }

  &__action {
    margin-left: auto;
    padding: 12rpx 0;
    font-size: 30rpx;
    color: $color-primary-deep;
  }
}

.subtitle {
  font-size: 26rpx;
}

/* ------------------------------------------------------------------ */
/*  成员列表（板19：首字母头像 + 徽章）                                  */
/* ------------------------------------------------------------------ */

.section__title {
  margin-bottom: 16rpx;
  font-size: 30rpx;
}

.row {
  @include list-row();

  &--hover {
    background-color: $color-card-soft;
  }
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  background-color: $color-card-soft;

  &--owner {
    background-color: $color-primary-soft;
  }

  &--pending {
    background-color: $color-amber-soft;
  }

  &__letter {
    font-size: 32rpx;
    font-weight: 600;
    color: $color-text-secondary;
  }
}

.avatar--owner .avatar__letter {
  color: $color-primary-deep;
}

.avatar--pending .avatar__letter {
  color: $color-amber-ink;
}

.row-title {
  font-size: 30rpx;
}

.row-desc {
  margin-top: 4rpx;
  font-size: 24rpx;
}

.row-chevron {
  width: 32rpx;
  height: 32rpx;
}

.badge {
  padding: 4rpx 20rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 600;

  &--owner {
    color: $color-primary-deep;
    background-color: $color-primary-soft;
  }

  &--pending {
    color: $color-amber-ink;
    background-color: $color-amber-soft;
  }
}

/* ------------------------------------------------------------------ */
/*  扫码加入卡（板19：二维码 + 两行说明 + 手动加入码）                    */
/* ------------------------------------------------------------------ */

.qr-card {
  gap: 8rpx;
  padding: 40rpx 32rpx 36rpx;

  &__qr {
    padding: 24rpx;
    background-color: $color-white; // 二维码底必须纯白
  }

  &__canvas {
    display: block;
  }

  &__title {
    margin-top: 16rpx;
    font-size: 30rpx;
  }

  &__desc {
    font-size: 24rpx;
  }

  &__code {
    margin-top: 4rpx;
    font-size: 22rpx;
  }
}

.qr-cta {
  margin-top: 24rpx;

  &__icon {
    width: 32rpx;
    height: 32rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  页脚权限说明                                                        */
/* ------------------------------------------------------------------ */

.footer {
  gap: 8rpx;
  margin-top: 8rpx;
}

.footnote {
  font-size: 24rpx;
  text-align: center;
}

.exit {
  margin-top: auto;
  width: 100%;
}

/* ------------------------------------------------------------------ */
/*  弹框（遮罩白卡，同设置页/配对页弹框；板⑤移除确认 + 邀请交付）          */
/* ------------------------------------------------------------------ */

.mask {
  position: fixed;
  inset: 0;
  z-index: 200; // 高于吸顶顶栏(.sticky-top z-100)
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: $color-mask;
}

.dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 590rpx;
  padding: 48rpx 40rpx 32rpx;
  border-radius: 32rpx;
  background-color: $color-card;

  &--invite {
    padding-top: 40rpx;
  }

  &__title {
    font-size: 34rpx;
    font-weight: 600;
  }

  &__body {
    margin-top: 16rpx;
    font-size: 26rpx;
    text-align: center;
    line-height: 1.6;
  }

  &__qr {
    margin-top: 28rpx;
    padding: 20rpx;
    background-color: $color-white;
  }

  &__canvas {
    display: block;
  }

  &__code {
    margin-top: 20rpx;
    font-size: 34rpx;
    letter-spacing: 4rpx;
  }

  &__btn {
    width: 100%;
    margin-top: 28rpx;
  }

  &__later {
    margin-top: 24rpx;
    padding: 8rpx;
    font-size: 25rpx;
  }
}
</style>
