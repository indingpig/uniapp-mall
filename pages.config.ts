import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages';

export default defineUniPages({
  pages: [],
  globalStyle: {
    backgroundColor: '@bgColor',
    backgroundColorBottom: '@bgColorBottom',
    backgroundColorTop: '@bgColorTop',
    backgroundTextStyle: '@bgTxtStyle',
    navigationBarBackgroundColor: '#000000',
    navigationBarTextStyle: '@navTxtStyle',
    navigationBarTitleText: '婴儿监护器',
    navigationStyle: 'custom',
  },
  tabBar: {
    custom: true,
    color: '#7a7e83',
    selectedColor: '#3cc51f',
    backgroundColor: '#ffffff',
    list: [
      {
        pagePath: 'pages/home/index',
        text: '首页',
      },
      {
        pagePath: 'pages/history/index',
        text: '历史',
      },
      {
        pagePath: 'pages/stats/index',
        text: '统计',
      },
      {
        pagePath: 'pages/settings/index',
        text: '设置',
      },
    ],
  },
  subPackages: [],
});
