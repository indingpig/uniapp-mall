import { onMounted, ref } from 'vue';
import { NAVIGATION_STYLE } from '@/config/navigation';

/**
 * 微信小程序胶囊按钮避让高度
 *
 * 仅当 globalStyle.navigationStyle 为 'custom' 时计算有效值，
 * 此时原生导航栏被隐藏，胶囊浮在页面内容上方需要避让。
 * 使用原生导航栏（'default'）时返回 0，系统已自动处理。
 */
export function useCapsuleGap() {
  const capsuleTopGap = ref<number>(0);

  onMounted(() => {
    if (NAVIGATION_STYLE !== 'custom') {
      return;
    }
    // #ifdef MP-WEIXIN
    try {
      const menuButton = uni.getMenuButtonBoundingClientRect();
      capsuleTopGap.value = menuButton.bottom - 23;
    }
    catch { /* 非微信环境或 API 不可用 */ }
    // #endif
  });

  return { capsuleTopGap };
}
