<script setup lang="ts">
/**
 * 开关行（设计规范 v1.1 第 5 节设置页「监控设置」+ 第 10 节组件拆分）
 *
 * Cell + 右侧 44×26 自绘开关（AppSwitch，150ms 拨动动画）。
 * v-model 直通开关状态，页面侧 watch model 即可响应变化。
 *
 * @example
 *   <SwitchRow v-model="cryAlert" title="哭声提醒" divider />
 *   <SwitchRow v-model="pushNotify" title="推送通知" />
 */
import AppSwitch from './AppSwitch.vue';
import Cell from './Cell.vue';

interface Props {
  /** 行标题 */
  title: string;
  disabled?: boolean;
  divider?: boolean;
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  divider: false,
});

const model = defineModel<boolean>({ required: true });
</script>

<template>
  <Cell :title="title" :divider="divider">
    <template #right>
      <AppSwitch v-model="model" :disabled="disabled" />
    </template>
  </Cell>
</template>
