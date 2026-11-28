import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const analyticsSite = process.env.CLOUDFLARE_WEB_ANALYTICS_SITE?.trim()
if (analyticsSite && !/^[a-f0-9]{32}$/i.test(analyticsSite)) {
  throw new Error('请使用 Cloudflare Web Analytics 的公开站点标识。')
}

export default defineConfig({
  base: './',
  define: { __FLOWER_ASSETS__: readFileSync(new URL('./public/assets/manifest.json', import.meta.url), 'utf8') },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'shared-scene-code-preload',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(_html, context) {
          const engine = Object.values(context.bundle ?? {}).find(output =>
            output.type === 'chunk' && Object.keys(output.modules).some(id => /\/three\/build\/three\.(core|module)\.js$/.test(id)))
          return engine ? [{ tag: 'link', attrs: { rel: 'modulepreload', href: './' + engine.fileName, fetchpriority: 'low' }, injectTo: 'head' }] : []
        },
      },
    },
    {
      name: 'site-visit-count',
      apply: 'build',
      transformIndexHtml() {
        if (!analyticsSite) return []
        return [{
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://static.cloudflareinsights.com/beacon.min.js',
            'data-cf-beacon': JSON.stringify({ token: analyticsSite, spa: false }),
          },
          injectTo: 'body',
        }]
      },
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { license: {fileName: 'dependency-licenses.md'}, chunkSizeWarningLimit: 1200 },
})

