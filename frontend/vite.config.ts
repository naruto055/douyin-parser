import { defineConfig } from 'vite'
import uniModule from '@dcloudio/vite-plugin-uni'
import { fileURLToPath, URL } from 'node:url'

const uni = typeof uniModule === 'function' ? uniModule : uniModule.default

export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
