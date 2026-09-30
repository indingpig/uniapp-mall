<!-- tab 页共用布局：页面内容 + 底部 TabBar。
     页面通过 <route> 块声明 { "layout": "tabbar" } 启用（pages.json 生成时透传，
     由 vite-plugin-uni-layouts 包装）。运行时仍每页各挂一个实例——uni.switchTab
     是整页替换，uni-app 没有跨页面持久的应用级外壳。 -->
<template>
  <slot />
  <CustomTabBar />
</template>
