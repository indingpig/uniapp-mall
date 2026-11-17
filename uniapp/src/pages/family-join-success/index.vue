<script setup lang="ts">
/**
 * 加入成功页（设计板 19「扫码加入态」）：家人扫码/受邀加入后的落地屏。
 * 设备信息取自加入时写入的配对记录，在线态实时查一次 server。
 */
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { fetchBabyStatus } from '@/api/baby';
import { CACHE_KEY } from '@/constants/cache';
import { colors } from '@/constants/colors';
import { getIcon } from '@/utils/icons';
import { storage } from '@/utils/storage';

const deviceName = ref('宝宝监护器');
const isOnline = ref(true);

const VIEW_ITEMS = ['实时状态与音量', '历史记录与统计', '事件与提醒记录'];

onShow(() => {
  const paired = storage.get<{ name?: string }>(CACHE_KEY.PAIRED_DEVICE);
  if (paired?.name) {
    deviceName.value = paired.name;
  }
  fetchBabyStatus().then((s) => {
    isOnline.value = s.isOnline;
  }).catch(() => {});
});

function goHome() {
  uni.switchTab({ url: '/pages/home/index' });
}
</script>

<template>
  <view class="page">
    <view class="flex flex-col flex-1">
      <!-- ========= 成功头图（板④：绿圈对勾 + 标题 + 副文） ========= -->
      <view class="hero flex flex-col items-center">
        <view class="hero__circle rounded-full flex items-center justify-center">
          <image class="hero__check" :src="getIcon('check', 'primaryDeep')" mode="aspectFit" />
        </view>
        <text class="hero__title text-main font-bold block">已加入家庭共享</text>
        <text class="hero__desc text-secondary block">现在可以查看宝宝的实时状态与历史记录</text>
      </view>

      <!-- ========= 设备卡（板④：设备名 + 已联网徽章） ========= -->
      <view class="device-card rounded-pill flex items-center">
        <view class="device-card__dot rounded-full" :class="isOnline ? 'bg-primary' : 'bg-card-soft'" />
        <text class="device-card__name font-semibold">{{ deviceName }}</text>
        <view class="flex-1" />
        <text class="device-card__status" :style="{ color: isOnline ? colors.primaryDeep : colors.warmGray }">
          {{ isOnline ? '已联网' : '设备离线' }}
        </text>
      </view>

      <!-- ========= 权限清单（板④：你可以查看） ========= -->
      <view class="perm-card bg-card rounded-lg flex flex-col">
        <text class="perm-card__title text-main font-bold block">你可以查看</text>
        <view v-for="item in VIEW_ITEMS" :key="item" class="perm-card__item flex items-center">
          <image class="perm-card__check" :src="getIcon('check', 'primary')" mode="aspectFit" />
          <text class="perm-card__item-text text-main block">{{ item }}</text>
        </view>
        <text class="perm-card__foot text-muted block">仅可查看，无法修改设备设置</text>
      </view>

      <!-- ========= CTA + 页脚 ========= -->
      <view class="bottom flex flex-col items-center">
        <AppButton size="cta" @tap="goHome">
          进入首页
        </AppButton>
        <text class="bottom__hint text-secondary block">如需退出，可在「设置 › 分享给家人」中操作</text>
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
  padding-top: calc(var(--status-bar-height) + 1.25rem);
  min-height: 100vh;
  background-color: $color-bg;
}

/* ------------------------------------------------------------------ */
/*  成功头图                                                            */
/* ------------------------------------------------------------------ */

.hero {
  margin-top: 15vh; // 板④头图位于屏幕上三分之一处

  &__circle {
    width: 240rpx;
    height: 240rpx;
    background-color: $color-primary-soft;
  }

  &__check {
    width: 110rpx;
    height: 110rpx;
  }

  &__title {
    margin-top: 48rpx;
    font-size: 44rpx;
  }

  &__desc {
    margin-top: 16rpx;
    font-size: 28rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  设备卡（浅绿胶囊）                                                  */
/* ------------------------------------------------------------------ */

.device-card {
  gap: 16rpx;
  margin-top: 48rpx;
  padding: 24rpx 32rpx;
  background-color: $color-primary-soft;

  &__dot {
    width: 14rpx;
    height: 14rpx;
  }

  &__name {
    font-size: 30rpx;
    color: $color-primary-deep;
  }

  &__status {
    font-size: 26rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  权限清单卡                                                          */
/* ------------------------------------------------------------------ */

.perm-card {
  margin-top: 32rpx;
  padding: 36rpx 32rpx 28rpx;

  &__title {
    font-size: 30rpx;
  }

  &__item {
    gap: 16rpx;
    padding: 20rpx 0;
  }

  &__check {
    width: 32rpx;
    height: 32rpx;
  }

  &__item-text {
    font-size: 30rpx;
  }

  &__foot {
    margin-top: 12rpx;
    font-size: 24rpx;
  }
}

/* ------------------------------------------------------------------ */
/*  底部 CTA + 页脚                                                     */
/* ------------------------------------------------------------------ */

.bottom {
  margin-top: auto; // 吸收剩余空间贴底
  width: 100%;

  &__hint {
    margin-top: 24rpx;
    font-size: 24rpx;
  }
}
</style>
