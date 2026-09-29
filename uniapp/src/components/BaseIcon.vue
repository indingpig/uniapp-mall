<script setup lang="ts">
import type { IconKey } from '@/utils/icons';
/**
 * 基础图标（设计规范 v1.1 第 9/14 节）
 *
 * 单一图标来源：utils/icons.ts（由 scripts/gen-icons.mjs 从设计稿图标库生成）。
 * 渲染方式为 base64 data URI + <image>，四端一致；颜色通过替换 SVG 内
 * currentColor 实现，因此 color 必传默认色（SVG 独立文档中 currentColor 无上下文）。
 *
 * 尺寸（规范第 10 节单位规则）：size prop 一律传设计稿 px（基准 390），
 * 内部经 uni.upx2px 按 rpx 口径换算 —— 动态内联样式在 H5/App 端不会被
 * 编译器转 rpx，必须走运行时 API，保证与静态样式的 rpx 同比例。
 *
 * @example
 *   <BaseIcon name="chevron-right" :size="16" :color="颜色token" />
 *   <BaseIcon name="spinner" :size="20" spin />  <!-- P0 动效：1s 匀速旋转 -->
 */
import { computed } from 'vue';
import { getIcon } from '@/utils/icons';

interface Props {
  /** 图标名，见 utils/icons.ts 的 IconKey */
  name: IconKey;
  /** 边长（设计稿 px，基准 390），非正方形图标按比例适配 */
  size?: number;
  /** 图标颜色；多色插画无 currentColor，传了不生效 */
  color?: string;
  /** 整体旋转（加载 spinner 用，1s linear infinite，规范 13.1 P0） */
  spin?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  color: '#3B362E',
  spin: false,
});

const src = computed(() => getIcon(props.name, props.color));

const sizeStyle = computed(() => {
  const px = uni.upx2px((props.size * 750) / 390);
  return { width: `${px}px`, height: `${px}px` };
});
</script>

<template>
  <image
    class="base-icon"
    :class="{ 'base-icon--spin': spin }"
    :src="src"
    mode="aspectFit"
    :style="sizeStyle"
  />
</template>

<style scoped>
.base-icon {
  display: block;
  flex-shrink: 0;
}

.base-icon--spin {
  animation: base-icon-spin 1s linear infinite;
}

@keyframes base-icon-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
