<script setup lang="ts">
/**
 * 注册页（设计板 23 三态 / 设计规范 v1.1.28 §5.6）
 *
 * 状态：默认 / 校验错误 / 手机号已注册。
 * - 字段规则：称呼非空；手机号 11 位；密码 8–20 位字母+数字；确认密码一致
 * - 手机号已注册（server 业务码 PHONE_REGISTERED）：标在手机号字段，
 *   同时密码槽展示强度条（弱/中/强 = 红/琥珀/绿，规范 5.6 仅此态展示）
 * - 其余服务端/网络错误：表单级红底条，不清空已填字段
 * 密码规则「8–20 位，字母 + 数字」放「密码」标签行右侧，不占错误槽。
 * 独立挂载：暂未接入启动流程（api/auth.ts 契约先行）。
 */
import { computed, reactive, ref } from 'vue';
import { authErrorOf, registerAccount } from '@/api/auth';
import { CACHE_KEY } from '@/constants/cache';
import { colors } from '@/constants/colors';
import { getIcon } from '@/utils/icons';
import { storage } from '@/utils/storage';

const PHONE_RE = /^1[3-9]\d{9}$/;

const name = ref('');
const phone = ref('');
const password = ref('');
const confirm = ref('');
const errors = reactive<{ name?: string; phone?: string; password?: string; confirm?: string }>({});
const formError = ref('');
const submitting = ref(false);
/** server 返回手机号已注册 → 密码槽展示强度条（规范 5.6） */
const phoneTaken = ref(false);

const brandIcon = computed(() => getIcon('device', 'primary'));
const errorIcon = computed(() => getIcon('error', 'danger'));

/* 强度条：三档 弱/中/强 = 红/琥珀/绿；线用语义色、字用对应深色（设计板 23） */
const STRENGTH_META = [
  { label: '弱', line: colors.danger, ink: colors.dangerInk },
  { label: '中', line: colors.amber, ink: colors.amberInk },
  { label: '强', line: colors.primary, ink: colors.primaryDeep },
] as const;

const pwdScore = computed(() => {
  const p = password.value;
  if (!p)
    return 0;
  const hasLetter = /[a-z]/i.test(p);
  const hasDigit = /\d/.test(p);
  if (p.length >= 12 && hasLetter && hasDigit)
    return 3;
  if (p.length >= 8 && hasLetter && hasDigit)
    return 2;
  return 1;
});

const strength = computed(() => STRENGTH_META[pwdScore.value - 1] ?? null);

function validate(): boolean {
  errors.name = name.value.trim() ? '' : '请输入你的称呼';
  errors.phone = PHONE_RE.test(phone.value) ? '' : '请输入正确的 11 位手机号';
  errors.password = password.value.length >= 8 && password.value.length <= 20 && /[a-z]/i.test(password.value) && /\d/.test(password.value)
    ? ''
    : '密码需 8–20 位，含字母和数字';
  errors.confirm = confirm.value === password.value ? '' : '两次输入的密码不一致';
  return !errors.name && !errors.phone && !errors.password && !errors.confirm;
}

function onEdit(field: 'name' | 'phone' | 'password' | 'confirm') {
  errors[field] = '';
  formError.value = '';
  if (field === 'phone')
    phoneTaken.value = false;
}

async function onSubmit() {
  if (submitting.value)
    return;
  formError.value = '';
  if (!validate())
    return;
  submitting.value = true;
  try {
    const data = await registerAccount(name.value.trim(), phone.value, password.value);
    // 账号体系未接入流程：凭证先落本地，进入 App 主页
    storage.set(CACHE_KEY.AUTH_TOKEN, data.token);
    uni.showToast({ title: '注册成功', icon: 'success' });
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 600);
  }
  catch (err) {
    const authErr = authErrorOf(err);
    if (authErr.code === 'PHONE_REGISTERED') {
      errors.phone = '该手机号已注册，请直接登录';
      phoneTaken.value = true;
    }
    else {
      formError.value = authErr.message || '网络异常，请稍后重试';
    }
  }
  finally {
    submitting.value = false;
  }
}

function goLogin() {
  if (submitting.value)
    return;
  // 登录页 → 注册页是 navigateTo 压栈进入时直接返回；直开注册页（无栈）则替换
  if (getCurrentPages().length > 1) {
    uni.navigateBack();
  }
  else {
    uni.redirectTo({ url: '/pages/login/index' });
  }
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
      <text class="card__title">创建账号</text>
      <text class="card__subtitle">注册后可绑定设备，随时查看宝宝状态</text>

      <view class="card__fields">
        <AppField
          v-model="name"
          label="你的称呼"
          :maxlength="20"
          placeholder="家人如何称呼你"
          :error="errors.name"
          :disabled="submitting"
          @update:model-value="onEdit('name')"
        />
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
          placeholder="请设置密码"
          :error="errors.password"
          :disabled="submitting"
          @update:model-value="onEdit('password')"
        >
          <template #label-right>
            <text class="pwd-rule">8–20 位，字母 + 数字</text>
          </template>
          <!-- 强度条仅「手机号已注册」态展示（规范 5.6），占密码字段的 20px 槽 -->
          <template v-if="phoneTaken && strength" #aux>
            <view class="strength">
              <view class="strength__bars">
                <view
                  v-for="i in 3"
                  :key="i"
                  class="strength__seg"
                  :style="{ backgroundColor: i <= pwdScore ? strength.line : colors.divider }"
                />
              </view>
              <text class="strength__label" :style="{ color: strength.ink }">密码强度：{{ strength.label }}</text>
            </view>
          </template>
        </AppField>
        <AppField
          v-model="confirm"
          label="确认密码"
          password
          :maxlength="20"
          placeholder="请再次输入密码"
          :error="errors.confirm"
          :disabled="submitting"
          @update:model-value="onEdit('confirm')"
        />
      </view>

      <view v-if="formError" class="form-error">
        <image class="form-error__icon" :src="errorIcon" mode="aspectFit" />
        <text class="form-error__text">{{ formError }}</text>
      </view>

      <view class="card__submit">
        <AppButton size="cta" @click="onSubmit">
          <view v-if="submitting" class="btn-spinner" />
          <text>{{ submitting ? '注册中…' : '注册并登录' }}</text>
        </AppButton>
      </view>

      <view class="card__alt">
        <text class="card__alt-text" :class="{ 'card__alt-text--muted': submitting }">已有账号？</text>
        <text class="link link--alt" :class="{ 'link--muted': submitting }" @click="goLogin">去登录</text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.page {
  @include page-layout;
}

/* 品牌区（设计板 23：图标顶 112 / 文案顶 188，扣除状态栏后留白 64） */
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: calc(var(--status-bar-height) + rpx(64));
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

/* 白卡（设计板 23：卡顶 228 / h530，同页各状态共用同一外框） */
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

/* 密码规则放标签行右侧（10/400，不占错误槽，规范 5.6） */
.pwd-rule {
  font-size: rpx(10);
  color: $color-text-muted;
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
  margin-top: rpx(10);
}

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

  &--muted {
    color: $color-text-muted;
  }

  &--alt {
    font-size: rpx(13);
    font-weight: 600;
  }
}

/* 密码强度条（设计板 23 手机号已注册态：3 段 62×3 间隙 4 + 右侧档位文字） */
.strength {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}

.strength__bars {
  display: flex;
  gap: rpx(4);
}

.strength__seg {
  width: rpx(62);
  height: rpx(3);
  border-radius: rpx(1.5);
}

.strength__label {
  font-size: rpx(11);
  font-weight: 500;
}
</style>
