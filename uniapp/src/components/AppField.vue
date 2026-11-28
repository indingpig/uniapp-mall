<script setup lang="ts">
/**
 * 登录/注册输入块（设计规范 v1.1.28 §5.6，设计板 22/23）
 *
 * 关键规则——固定 82 节距 = 58 输入框 + 4 间距 + 20 错误槽：
 * 错误文案只占预留槽，校验前后高度一致、输入不跳；无内容时槽位留空不压缩。
 * 错误态：#F8E3DE 底 + #D96A5B 描边 + 标签转红 + 槽内 13px ic-error + 12px 红字，
 * 就地展示不弹 toast。提交中整表禁用：#F5EFE6 底 + #A39B8C 文字（设计板 22-提交中）。
 *
 * @example
 *   <AppField v-model="phone" label="手机号" input-type="number" :maxlength="11"
 *             :error="errors.phone" :disabled="submitting" @update:model-value="errors.phone = ''" />
 *   <AppField v-model="password" label="密码" password :error="errors.password">
 *     <template #label-right><text class="pwd-rule">8–20 位，字母 + 数字</text></template>
 *     <template #aux>…密码强度条…</template>
 *   </AppField>
 */
import { computed, ref } from 'vue';
import { colors } from '@/constants/colors';
import { getIcon } from '@/utils/icons';

interface Props {
  label: string;
  modelValue?: string;
  placeholder?: string;
  /** uni input 键盘类型（密码掩码走独立 password 开关） */
  inputType?: 'text' | 'number';
  /** 密码框：掩码显示 + 右侧眼睛切换明文 */
  password?: boolean;
  /** 字段级错误文案（占 20px 槽；空 = 正常态，槽位留空） */
  error?: string;
  /** 提交中禁用：整块变 #F5EFE6 底 + #A39B8C 文字 */
  disabled?: boolean;
  maxlength?: number;
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  inputType: 'text',
  password: false,
  error: '',
  disabled: false,
  maxlength: 20,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const showPwd = ref(false);

const eyeIcon = computed(() => getIcon('eye', 'muted'));
const errorIcon = computed(() => getIcon('error', 'danger'));
/** uni input 占位色只能走内联样式字符串，色值取自 TS 侧色源 */
const placeholderStyle = `color: ${colors.muted}; font-weight: 500;`;

function onInput(e: { detail: { value: string } }) {
  emit('update:modelValue', e.detail.value);
}
</script>

<template>
  <view class="field">
    <view
      class="field__box"
      :class="{ 'field__box--error': error, 'field__box--disabled': disabled, 'field__box--pwd': password }"
    >
      <view class="field__meta">
        <text class="field__label" :class="{ 'field__label--error': error }">{{ label }}</text>
        <slot name="label-right" />
      </view>
      <input
        class="field__input"
        :class="{ 'field__input--disabled': disabled }"
        :value="modelValue"
        :type="password ? 'text' : inputType"
        :password="password && !showPwd"
        :placeholder="placeholder"
        :placeholder-style="placeholderStyle"
        :maxlength="maxlength"
        :disabled="disabled"
        @input="onInput"
      >
      <image
        v-if="password"
        class="field__eye"
        :src="eyeIcon"
        mode="aspectFit"
        @click="showPwd = !showPwd"
      />
    </view>
    <!-- 固定 20px 槽：错误文案或 #aux 内容（如强度条），空则留白，保证节距恒定 -->
    <view class="field__slot">
      <view v-if="error" class="field__error">
        <image class="field__error__icon" :src="errorIcon" mode="aspectFit" />
        <text class="field__error__text">{{ error }}</text>
      </view>
      <slot v-else name="aux" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.field {
  width: 100%;
}

.field__box {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: rpx(4);
  height: rpx(58);
  padding: 0 rpx(14);
  background-color: $color-card;
  border: 1px solid $color-border;
  border-radius: rpx(12);

  // 密码框给 18px 眼睛留位
  &--pwd {
    padding-right: rpx(46);
  }

  // 错误态：浅红底 + 红描边（标签/文字同步转红见下）
  &--error {
    background-color: $color-danger-soft;
    border-color: $color-danger;
  }

  // 提交中禁用（设计板 22）：底色变灰，描边不变
  &--disabled {
    background-color: $color-input-disabled;
  }
}

.field__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field__label {
  font-size: rpx(11);
  font-weight: 500;
  color: $color-text-secondary;

  &--error {
    color: $color-danger;
  }
}

.field__input {
  height: rpx(22);
  font-size: rpx(15);
  font-weight: 500;
  color: $color-text-primary;

  &--disabled {
    color: $color-disabled;
  }
}

.field__eye {
  position: absolute;
  top: 50%;
  right: rpx(14);
  width: rpx(18);
  height: rpx(18);
  transform: translateY(-50%);
}

// 固定槽位：58 框 + 4 间距 + 20 槽 = 82 节距，任何状态下不伸缩
.field__slot {
  height: rpx(20);
  margin-top: rpx(4);
}

.field__error {
  display: flex;
  align-items: center;
  gap: rpx(5);
  height: 100%;
}

.field__error__icon {
  flex-shrink: 0;
  width: rpx(13);
  height: rpx(13);
}

.field__error__text {
  font-size: rpx(12);
  color: $color-danger;
}
</style>
