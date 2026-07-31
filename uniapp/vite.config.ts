import { fileURLToPath, URL } from 'node:url';

import Uni from '@uni-helper/plugin-uni';
import Components from '@uni-helper/vite-plugin-uni-components';
import { UniUIResolver } from '@uni-helper/vite-plugin-uni-components/resolvers';
import UniLayouts from '@uni-helper/vite-plugin-uni-layouts';
import UniManifest from '@uni-helper/vite-plugin-uni-manifest';
import UniPages from '@uni-helper/vite-plugin-uni-pages';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/uni.scss" as *;\n@use "@/styles/page-layout.scss" as *;\n@use "@/styles/state.scss" as *;\n@use "@/styles/button.scss" as *;\n@use "@/styles/list-item.scss" as *;\n@use "@/styles/section.scss" as *;\n`,
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    // https://uni-helper.js.org/vite-plugin-uni-components
    Components({
      dts: true,
      resolvers: [UniUIResolver()],
    }),
    // https://uni-helper.js.org/vite-plugin-uni-pages
    UniPages(),
    // https://uni-helper.js.org/vite-plugin-uni-layouts
    UniLayouts(),
    // https://uni-helper.js.org/vite-plugin-uni-manifest
    UniManifest(),
    // https://uni-helper.js.org/plugin-uni
    Uni(),
  ],

});
