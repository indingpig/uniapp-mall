<script setup lang="ts">
/**
 * 登录页（设计板 22 四态 / 设计规范 v1.1.28 §5.6）
 *
 * 状态：默认 / 校验错误 / 账号或密码错误 / 提交中。
 * - 校验错误：字段级就地报错（红框 + 20px 固定槽行内文案），不弹 toast
 * - 账号或密码错误：server 业务码 AUTH_FAILED → 标在密码字段（设计板 22 态三）
 * - 其余服务端/网络错误：表单级红底条（不清空已填字段、不误标字段）
 * - 提交中：按钮转指示器 +「登录中…」，整表禁用防重复提交
 * 范围：无返回键（靠系统手势）；无协议勾选（自用场景）。
 * 独立挂载：暂未接入启动流程，入口后续随账号体系接线（api/auth.ts 契约先行）。
 */
import { computed, reactive, ref } from 'vue';
import { authErrorOf, loginByPassword } from '@/api/auth';
import { CACHE_KEY } from '@/constants/cache';
import { getIcon } from '@/utils/icons';
import { storage } from '@/utils/storage';

const PHONE_RE = /^1[3-9]\d{9}$/;

const phone = ref('');
const password = ref('');
const errors = reactive<{ phone?: string; password?: string }>({});
const formError = ref('');
const submitting = ref(false);

const brandIcon = computed(() => getIcon('device', 'primary'));
const errorIcon = computed(() => getIcon('error', 'danger'));

function validate(): boolean {
  errors.phone = PHONE_RE.test(phone.value) ? '' : '请输入正确的 11 位手机号';
  errors.password = password.value ? '' : '请输入密码';
  return !errors.phone && !errors.password;
}

/** 输入即清该字段错误 + 表单级错误（错误只在提交时重新判定） */
function onEdit(field: 'phone' | 'password') {
  errors[field] = '';
  formError.value = '';
}

async function onSubmit() {
  if (submitting.value)
    return;
  formError.value = '';
  if (!validate())
    return;
  submitting.value = true;
  try {
    const data = await loginByPassword(phone.value, password.value);
    // 账号体系未接入流程：凭证先落本地，进入 App 主页（行为与配对认领后的落点一致）
    storage.set(CACHE_KEY.AUTH_TOKEN, data.token);
    uni.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 600);
  }
  catch (err) {
    const authErr = authErrorOf(err);
    if (authErr.code === 'AUTH_FAILED') {
      errors.password = '手机号或密码不正确';
    }
    else {
      formError.value = authErr.message || '网络异常，请稍后重试';
    }
  }
  finally {
    submitting.value = false;
  }
}

function onForgot() {
  if (submitting.value)
    return;
  uni.showToast({ title: '暂未开放，敬请期待', icon: 'none' });
}

function goRegister() {
  if (submitting.value)
    return;
  uni.navigateTo({ url: '/pages/register/index' });
}
</script>

<template>
  <view class="page">
    <view class="brand">
      <view class="brand__halo">
        <view class="brand__circle">
          <image class="brand__icon" :src="brandIcon" mode="aspectFit" />
        </view>
      </view>
      <text class="brand__name">宝宝监护器</text>
    </view>

    <view class="card">
      <text class="card__title">欢迎回来</text>
      <text class="card__subtitle">登录后可继续管理设备与家庭共享</text>

      <view class="card__fields">
        <AppField
          v-model="phone"
          label="手机号"
          input-type="number"
          :maxlength="11"
          placeholder="请输入手机号"
          :error="errors.phone"
          :disabled="submitting"
          @update:model-value="onEdit('phone')"
        />
        <AppField
          v-model="password"
          label="密码"
          password
          :maxlength="20"
          placeholder="请输入密码"
          :error="errors.password"
          :disabled="submitting"
          @update:model-value="onEdit('password')"
        />
      </view>

      <view class="card__forgot">
        <text class="link" :class="{ 'link--muted': submitting }" @click="onForgot">忘记密码？</text>
      </view>

      <view v-if="formError" class="form-error">
        <image class="form-error__icon" :src="errorIcon" mode="aspectFit" />
        <text class="form-error__text">{{ formError }}</text>
      </view>

      <view class="card__submit">
        <AppButton size="cta" @click="onSubmit">
          <view v-if="submitting" class="btn-spinner" />
          <text>{{ submitting ? '登录中…' : '登录' }}</text>
        </AppButton>
      </view>

      <view class="card__alt">
        <text class="card__alt-text" :class="{ 'card__alt-text--muted': submitting }">还没有账号？</text>
        <text class="link link--alt" :class="{ 'link--muted': submitting }" @click="goRegister">立即注册</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  @include page-layout;
}

/* 品牌区（设计板 22：图标顶 190 / 文案顶 264，扣除状态栏后留白 140） */
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: calc(var(--status-bar-height) + rpx(140));
}

.brand__halo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: rpx(80);
  height: rpx(80);
  background-color: rgba($color-primary-soft, 0.45);
  border-radius: 50%;
}

.brand__circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: rpx(64);
  height: rpx(64);
  background-color: $color-primary-soft;
  border-radius: 50%;
}

.brand__icon {
  width: rpx(32);
  height: rpx(32);
}

.brand__name {
  display: block;
  margin-top: rpx(12);
  font-size: rpx(12);
  font-weight: 500;
  letter-spacing: rpx(2);
  color: $color-text-secondary;
}

/* 白卡（设计板 22：卡顶 304 / h378，同页各状态共用同一外框） */
.card {
  margin: rpx(23) rpx(20) 0;
  padding: rpx(20) rpx(24);
  background-color: $color-card;
  border: 1px solid $color-border;
  border-radius: rpx(20);
}

.card__title {
  display: block;
  font-size: rpx(23);
  font-weight: 700;
  color: $color-text-primary;
}

.card__subtitle {
  display: block;
  margin-top: rpx(8);
  font-size: rpx(13);
  color: $color-text-secondary;
}

.card__fields {
  margin-top: rpx(18);
}

.card__forgot {
  display: flex;
  justify-content: flex-end;
  margin-top: rpx(2);
}

.form-error {
  display: flex;
  align-items: center;
  gap: rpx(8);
  margin-top: rpx(12);
  padding: rpx(10) rpx(12);
  background-color: $color-danger-soft;
  border-radius: rpx(8);
}

.form-error__icon {
  flex-shrink: 0;
  width: rpx(14);
  height: rpx(14);
}

.form-error__text {
  font-size: rpx(12.5);
  color: $color-danger;
}

.card__submit {
  margin-top: rpx(12);
}

/* 提交中指示器（设计板 22：14px 旋转环，整表禁用防重复提交） */
.btn-spinner {
  width: rpx(14);
  height: rpx(14);
  border: rpx(2) solid rgba($color-white, 0.35);
  border-top-color: $color-white;
  border-radius: 50%;
  animation: auth-spin 0.8s linear infinite;
}

@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}

.card__alt {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: rpx(4);
  margin-top: rpx(20);
}

.card__alt-text {
  font-size: rpx(13);
  color: $color-text-secondary;

  &--muted {
    color: $color-text-muted;
  }
}

.link {
  font-size: rpx(12.5);
  font-weight: 500;
  color: $color-primary-deep;

  // 提交中链接置灰不可点（设计板 22 提交中态）
  &--muted {
    color: $color-text-muted;
  }

  &--alt {
    font-size: rpx(13);
    font-weight: 600;
  }
}
</style>
