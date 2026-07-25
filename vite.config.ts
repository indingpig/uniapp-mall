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
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
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
