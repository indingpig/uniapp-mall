<script setup lang="ts">
/**
 * 开关（设计规范 v1.1 第 4 节：44×26 r13，球 22 带投影，ON=绿、球居右）
 *
 * 自绘而非样式化内置 switch：内置组件跨端无法做到该几何与投影。
 * 拨动动画为规范 13.1 P0：球位移 + 底色过渡 150ms ease（纯 CSS transition）。
 *
 * @example
 *   <AppSwitch v-model="cryAlert" />
 *   <AppSwitch v-model="pushNotify" disabled />
 */
interface Props {
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
});

const emit = defineEmits<{ change: [value: boolean] }>();

const model = defineModel<boolean>({ required: true });

function toggle() {
  if (props.disabled) {
    return;
  }
  model.value = !model.value;
  emit('change', model.value);
}
</script>

<template>
  <view
    class="switch"
    :class="{ 'switch--on': model, 'switch--disabled': disabled }"
    @tap="toggle"
  >
    <view class="switch__knob" />
  </view>
</template>

<style scoped>
.switch {
  position: relative;
  width: rpx(44);
  height: rpx(26);
  border-radius: rpx(13);
  background-color: $color-card-soft;
  transition: background-color 150ms ease;
  flex-shrink: 0;
}

.switch--on {
  background-color: $color-primary;
}

.switch__knob {
  position: absolute;
  top: rpx(2);
  left: rpx(2);
  width: rpx(22);
  height: rpx(22);
  border-radius: 50%;
  background-color: #FFFFFF;
  box-shadow: 0 rpx(1) rpx(3) rgba(0, 0, 0, 0.15);
  transition: transform 150ms ease;
}

.switch--on .switch__knob {
  /* 行程 = 轨道宽 − 球径 − 两侧内边距（44 − 22 − 2×2） */
  transform: translateX(rpx(18));
}

.switch--disabled {
  opacity: 0.5;
}
</style>
