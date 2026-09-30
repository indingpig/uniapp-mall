<script setup lang="ts">
/**
 * 按钮（设计规范 v1.1 第 8 节「按钮」）
 *
 * 三种形态：
 * - primary 主：绿底白字胶囊（CTA、快捷操作、扫描）
 * - secondary 次：白底 1px #E5DECF 描边（发丝线属 px 例外清单）
 * - danger 危险文本：红字、无底（退出登录）
 * 尺寸：cta = h50（页面主 CTA）；quick = h48（快捷操作对 1:1）；small = 104×34（扫描/停止扫描）。
 * disabled：#EDE6D8 底 + #A39B8C 文字（12.1 快捷操作禁用变体），不可点。
 * 按压反馈 opacity 0.8 / 80ms（规范 13.1 P2）。
 *
 * @example
 *   <AppButton size="cta"><BaseIcon name="bluetooth" :size="18" color="#FFFFFF" />去配对设备</AppButton>
 *   <AppButton size="quick" variant="secondary" :disabled="offline">静音提醒</AppButton>
 *   <AppButton variant="danger">退出登录</AppButton>
 */
import { computed } from 'vue';

interface Props {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'cta' | 'quick' | 'small';
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'quick',
  disabled: false,
});

const hoverClass = computed(() => (props.disabled ? 'none' : 'app-btn--hover'));
</script>

<template>
  <button
    class="app-btn"
    :class="[`app-btn--${variant}`, `app-btn--${size}`, { 'app-btn--disabled': disabled }]"
    :hover-class="hoverClass"
    :hover-stay-time="60"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
/* 重置 uni-app <button> 默认样式（含小程序 ::after 边框） */
.app-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: rpx(6);
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  line-height: 1;
  font-weight: 600;
}

.app-btn::after {
  border: none;
}

/* 尺寸 */
.app-btn--cta {
  height: rpx(50);
  border-radius: rpx(25);
  font-size: rpx(15);
}

.app-btn--quick {
  height: rpx(48);
  border-radius: rpx(24);
  font-size: rpx(14);
}

.app-btn--small {
  width: rpx(104);
  height: rpx(34);
  border-radius: rpx(17);
  font-size: rpx(13);
}

/* 形态 */
.app-btn--primary {
  background-color: $color-primary;
  color: #FFFFFF;
}

.app-btn--secondary {
  background-color: $color-card;
  border: 1px solid $color-border-btn;
  color: $color-text-primary;
  font-weight: 500;
}

.app-btn--danger {
  height: rpx(48);
  background-color: transparent;
  color: $color-danger;
  font-weight: 500;
}

/* 禁用态（12.1：#EDE6D8 底 + #A39B8C 图标文字） */
.app-btn--disabled {
  background-color: $color-card-soft;
  border: none;
  color: #A39B8C;
}

.app-btn--hover {
  opacity: 0.8;
}
</style>
