<script setup lang="ts">
/**
 * 彩色图标圈（设计规范 v1.1 第 8 节：32/40px 正圆图标容器）
 *
 * 事件行、权益卡、设置行的通用结构：彩色浅底正圆 + 居中图标
 * （圆内一般放 BaseIcon 16px，由调用方指定图标与颜色）。
 *
 * @example
 *   <IconCircle bg="#F8E3DE"><BaseIcon name="droplet" :size="16" color="#D96A5B" /></IconCircle>
 *   <IconCircle size="lg" bg="#EDE6D8"><BaseIcon name="plus" :size="20" color="#3B362E" /></IconCircle>
 */
interface Props {
  /** 圆底色（任意 CSS 颜色；语义浅底 token 见 styles/uni.scss 的 *-soft 系列） */
  bg?: string;
  /** sm = 32px（事件行/权益卡）；lg = 40px（设置行） */
  size?: 'sm' | 'lg';
}

withDefaults(defineProps<Props>(), {
  bg: '',
  size: 'sm',
});
</script>

<template>
  <view
    class="icon-circle"
    :class="`icon-circle--${size}`"
    :style="bg ? { backgroundColor: bg } : undefined"
  >
    <slot />
  </view>
</template>

<style scoped>
.icon-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
}

.icon-circle--sm {
  width: rpx(32);
  height: rpx(32);
}

.icon-circle--lg {
  width: rpx(40);
  height: rpx(40);
}
</style>
