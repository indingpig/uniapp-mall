<script setup lang="ts">
/**
 * 实时音量条（设计规范 v1.1 第 7 / 12.1 / 13.1 节）
 *
 * 结构（视觉口径同矢量参照稿）：三分区底（60/20/20 宽）→ 深绿填充层 → 白色游标。
 * 映射：音量% = clamp((dB - min) / (max - min), 0, 1)；dB < min（环境底噪）自然为空条，
 * 「安静」文案由页面层显示，本组件只负责条本身。
 *
 * 动画（规范 13.1 v1.1.6④，P0）：数据驱动、300ms ease；实现必须走 transform ——
 * 填充 scaleX、游标 translateX，禁止 width/left 动画引发重排。
 *
 * @example
 *   <VolumeBar :dB="55" />                 <!-- 55dB → 42% -->
 *   <VolumeBar :dB="baseCalibratedDb" :min="noiseFloor" />  <!-- 底噪校准 MIN = max(30, N+5) -->
 *   <VolumeBar :dB="null" />               <!-- 离线/无数据：整条中性底（12.1 禁用变体） -->
 */
import { computed } from 'vue';

interface Props {
  /** 实时音量（dB）；null 视为无数据，渲染禁用轨道 */
  dB?: number | null;
  /** 映射下界（规范第 7 节 MIN：未校准 30，校准后 max(30, N+5)） */
  min?: number;
  /** 映射上界 */
  max?: number;
  /** 强制禁用（设备离线变体，12.1） */
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  dB: null,
  min: 30,
  max: 90,
  disabled: false,
});

const isDisabled = computed(() => props.disabled || props.dB === null);

const percent = computed(() => {
  if (props.dB === null || props.max <= props.min) {
    return 0;
  }
  const ratio = (props.dB - props.min) / (props.max - props.min);
  return Math.min(1, Math.max(0, ratio));
});
</script>

<template>
  <view class="vbar" :class="{ 'vbar--disabled': isDisabled }">
    <template v-if="!isDisabled">
      <view class="vbar__zone vbar__zone--1" />
      <view class="vbar__zone vbar__zone--2" />
      <view class="vbar__zone vbar__zone--3" />
      <view class="vbar__fill" :style="{ transform: `scaleX(${percent})` }" />
      <view class="vbar__mark" :style="{ transform: `translateX(${percent * 100}%)` }">
        <view class="vbar__mark-dot" />
      </view>
    </template>
  </view>
</template>

<style scoped>
/* 容器高 18px：10px 轨道 + 游标 14px 的上下溢出空间 */
.vbar {
  position: relative;
  height: 18px;
}

/* 离线/无数据变体（12.1）：整条 #EDE6D8，无分区/填充/游标 */
.vbar--disabled {
  height: 10px;
  border-radius: 5px;
  background-color: $color-card-soft;
}

.vbar__zone {
  position: absolute;
  top: 4px;
  height: 10px;
  border-radius: 5px;
}

.vbar__zone--1 {
  left: 0;
  width: 60%;
  background-color: $volume-zone-1;
}

.vbar__zone--2 {
  left: 60%;
  width: 20%;
  background-color: $volume-zone-2;
}

.vbar__zone--3 {
  left: 80%;
  width: 20%;
  background-color: $volume-zone-3;
}

/* 填充层宽度恒为 100%，比例由 scaleX 表达（左缘为轴，右端圆帽形变被游标遮盖） */
.vbar__fill {
  position: absolute;
  top: 4px;
  left: 0;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  background-color: $color-primary;
  transform-origin: 0 50%;
  transition: transform 300ms ease;
}

/* 游标包裹层宽 = 行程（容器宽 - 14px），translateX 百分比即行程比例；
   圆点钉在包裹层左缘外扩 7px，圆心恰好落在音量位置上 */
.vbar__mark {
  position: absolute;
  top: 2px;
  left: 7px;
  right: 7px;
  height: 14px;
  transition: transform 300ms ease;
}

.vbar__mark-dot {
  position: absolute;
  left: -7px;
  top: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background-color: #FFFFFF;
  border: 3px solid $color-primary;
  box-sizing: border-box;
}
</style>
