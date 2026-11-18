import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^DB_HANDLERS_ELECTRON_RENDERER_OR_WEB$/, replacement: resolve(rootDir, 'src/datastores/handlers/electron.js') },
      { find: /^youtubei\.js$/, replacement: 'youtubei.js/web' },
      { find: /^shaka-player$/, replacement: 'shaka-player/dist/shaka-player.ui-es2021.js' },
      { find: /^@fortawesome\/fontawesome-svg-core$/, replacement: resolve(rootDir, 'src/renderer/fontawesome-minimal.js') },
      { find: /^dompurify$/, replacement: resolve(rootDir, '_scripts/_undefinedDefaultExport.mjs') },
    ],
    extensions: ['.js', '.vue'],
  },
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    __VUE_I18N_LEGACY_API__: 'false',
    __VUE_I18N_FULL_INSTALL__: 'false',
    __INTLIFY_PROD_DEVTOOLS__: 'false',
    'process.env.IS_ELECTRON': 'true',
    'process.env.SUPPORTS_LOCAL_API': 'true',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
})
