import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages';
import { NAVIGATION_STYLE } from './src/config/navigation';

export default defineUniPages({
  pages: [],
  globalStyle: {
    backgroundColor: '@bgColor',
    backgroundColorBottom: '@bgColorBottom',
    backgroundColorTop: '@bgColorTop',
    backgroundTextStyle: '@bgTxtStyle',
    navigationBarBackgroundColor: '#F4EDE1', // 与 theme.json light.bgColor 一致（navigationStyle 为 custom，实际不渲染）
    navigationBarTextStyle: '@navTxtStyle',
    navigationBarTitleText: '婴儿监护器',
    navigationStyle: NAVIGATION_STYLE,
  },
  tabBar: {
    custom: true,
    color: '#8C8578',
    selectedColor: '#7BA05B', // 主绿，原值为设计稿外的 #7ea279
    backgroundColor: '#FFFFFF', // 与 $color-card 一致
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
        iconPath: 'static/tabbar/home.png',
        selectedIconPath: 'static/tabbar/home-active.png',
      },
      {
        pagePath: 'pages/history/index',
        text: '历史',
        iconPath: 'static/tabbar/clock.png',
        selectedIconPath: 'static/tabbar/clock-active.png',
      },
      {
        pagePath: 'pages/stats/index',
        text: '统计',
        iconPath: 'static/tabbar/chart.png',
        selectedIconPath: 'static/tabbar/chart-active.png',
      },
      {
        pagePath: 'pages/settings/index',
        text: '设置',
        iconPath: 'static/tabbar/gear.png',
        selectedIconPath: 'static/tabbar/gear-active.png',
      },
    ],
  },
  subPackages: [],
});
