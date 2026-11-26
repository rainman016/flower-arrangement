# 一席花

在竹林或溪畔坐下，倒一杯水，挑选、端详、修剪枝叶，把花放进瓶中，最后保存自己的作品。五式均可用鼠标或触屏操作，进度和祝愿保存在当前浏览器。

**[打开网页版](https://rainman016.github.io/flower-arrangement/)** · [低画质入口](https://rainman016.github.io/flower-arrangement/?quality=low)

每次打开或刷新网页，先选「竹林清风」或「溪畔观流」。此时只加载两张预览图和界面，选定后才载入对应的三维场景。有存档可点「继续上次花席」，选新场景会先提示确认。

玩家需要支持 WebGL 2 且开启图形加速的浏览器。手机推荐直接用 Safari 或 Chrome 打开网址。自然声在与页面交互后播放。

## 本地开发

本项目使用 Node.js 24 和 pnpm 11.25.0。

~~~sh
pnpm install --frozen-lockfile
pnpm dev
~~~

运行 `pnpm test` 检查规则和几何，`pnpm run check:assets` 检查素材，`pnpm build` 生成静态网站到 dist。网站使用相对路径，可以部署在 GitHub Pages 的项目子目录。本仓库的 Pages 发布源是 gh-pages 分支的根目录。用 `pnpm build:offline` 可另外生成单文件试玩。分发试玩时请同时提供素材说明和生产网页构建生成的 dependency-licenses.md。

## 访问统计

在线版支持 Cloudflare Web Analytics。发布者可在构建环境中设置 CLOUDFLARE_WEB_ANALYTICS_SITE 为自己站点的公开标识，再运行 pnpm build。配置后只为上线的 HTML 加入访问统计。游戏进度、祝愿文字和作品图始终留在浏览器内。默认构建及单文件离线试玩均可独立使用。

## 授权

本项目原创程序代码采用 [MIT 许可证](LICENSE)。引导文案和原创美术的其他使用须取得相应权利人的许可。第三方录音、扫描素材和库遵循各自许可证。风声与溪流声的作者、来源、改制说明见[第三方素材说明](public/THIRD_PARTY_NOTICES.md)。网页发布物也附带[依赖许可清单](https://rainman016.github.io/flower-arrangement/dependency-licenses.md)。
