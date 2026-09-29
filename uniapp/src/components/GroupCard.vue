<script setup lang="ts">
/**
 * 分组卡片（设计规范 v1.1 第 5 节设置页三分组 + 第 8 节卡片规格）
 *
 * 分组标题（13/500 #6E675B）+ 白卡内容区（r16、1px #EBE3D4 描边、
 * overflow hidden 使内部 Cell 分割线贴合圆角）。区块间距由页面控制
 * （规范第 4 节：14，监听中态例外 12）。
 *
 * @example
 *   <GroupCard title="监控设置">
 *     <SwitchRow v-model="cryAlert" title="哭声提醒" divider />
 *     <Cell title="灵敏度阈值" value="中等" chevron />
 *   </GroupCard>
 */
interface Props {
  /** 分组标题；不传则只渲染卡片 */
  title?: string;
}

withDefaults(defineProps<Props>(), {
  title: '',
});
</script>

<template>
  <view class="group-card">
    <text v-if="title" class="group-card__title">{{ title }}</text>
    <view class="group-card__body">
      <slot />
    </view>
  </view>
</template>

<style scoped>
.group-card {
  display: flex;
  flex-direction: column;
  gap: rpx(8);
}

.group-card__title {
  font-size: rpx(13);
  font-weight: 500;
  color: $color-ink-group;
}

.group-card__body {
  background-color: $color-card;
  border: 1px solid $color-border;
  border-radius: $radius-card;
  overflow: hidden;
}
</style>
