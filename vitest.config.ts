import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
export default defineConfig({
  define: { __FLOWER_ASSETS__: readFileSync(new URL('./public/assets/manifest.json', import.meta.url), 'utf8') },
  test: { include: ['tests/game/**/*.test.ts'], environment: 'node' },
})

