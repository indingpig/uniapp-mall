<script setup lang="ts">
/**
 * 通用列表行（设计规范 v1.1 第 8 节「卡片/列表行」+ 第 10 节组件拆分）
 *
 * 结构：图标(22 裸图标或 32/40 圆) + 标题/副标题 + 右值/胶囊 + chevron 16，
 * 行高 44–56，分割线 #F2EDE2 1px。放在白色卡片内使用（本组件自身无底色）。
 * 六插槽：icon / title / desc / value / right / footer；
 * right 会整体替换右侧区（放开关、徽章时用），value 只替换值文本。
 *
 * @example
 *   <Cell title="灵敏度阈值" value="中等" chevron divider clickable @tap="goSensitivity">
 *     <template #icon><BaseIcon name="activity" :size="22" /></template>
 *   </Cell>
 */
import { useSlots } from 'vue';
import BaseIcon from './BaseIcon.vue';

interface Props {
  /** 主标题（14px/500） */
  title?: string;
  /** 副标题（12px，标题下方） */
  desc?: string;
  /** 右侧值文本（14px，ink-2） */
  value?: string;
  /** 是否显示右侧 chevron（16px ink-3） */
  chevron?: boolean;
  /** 是否显示底部 1px 分割线 */
  divider?: boolean;
  /** 可点态：按压时 opacity 0.8（规范 13.1 P2 按压反馈） */
  clickable?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: '',
  desc: '',
  value: '',
  chevron: false,
  divider: false,
  clickable: false,
});

const slots = useSlots();
</script>

<template>
  <view
    class="cell"
    :hover-class="clickable ? 'cell--hover' : 'none'"
    :hover-stay-time="60"
  >
    <view class="cell__row">
      <view v-if="slots.icon" class="cell__icon">
        <slot name="icon" />
      </view>
      <view class="cell__main">
        <view v-if="title || slots.title" class="cell__title">
          <slot v-if="slots.title" name="title" />
          <text v-else class="cell__title-text">{{ title }}</text>
        </view>
        <view v-if="desc || slots.desc" class="cell__desc">
          <slot v-if="slots.desc" name="desc" />
          <text v-else class="cell__desc-text">{{ desc }}</text>
        </view>
      </view>
      <view v-if="value || slots.value || slots.right || chevron" class="cell__right">
        <slot v-if="slots.right" name="right" />
        <template v-else>
          <slot v-if="slots.value" name="value" />
          <text v-else-if="value" class="cell__value">{{ value }}</text>
          <BaseIcon name="chevron-right" :size="16" color="#B3AB9D" />
        </template>
      </view>
    </view>
    <view v-if="slots.footer" class="cell__footer">
      <slot name="footer" />
    </view>
    <view v-if="divider" class="cell__divider" />
  </view>
</template>

<style scoped>
.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  transition: opacity 80ms ease;
}

.cell--hover {
  opacity: 0.8;
}

.cell__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 12px 16px;
  box-sizing: border-box;
}

.cell__icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.cell__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell__title-text {
  font-size: 14px;
  font-weight: 500;
  color: $color-text-primary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell__desc-text {
  font-size: 12px;
  color: $color-text-secondary;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.cell__value {
  font-size: 14px;
  color: $color-text-secondary;
}

.cell__footer {
  padding: 0 16px 12px;
}

.cell__divider {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background-color: $color-divider;
}
</style>
