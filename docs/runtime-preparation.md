# 环境准备与验证

默认画质从素材清单加载预生成的真实几何、实例、材质和纹理；原始环境保留作制作与资源失败回退。相机、风动、水面、器物及交互仍在运行时更新。

## 修改环境后

准备包的 `preparedFor` 当前只检查原始模型文件名，不自动追踪环境 TypeScript 的变化。修改植被、地形、环境材质或准备脚本后，必须重新生成受影响场景的包；否则默认画质可能继续显示旧环境。相机、桌面和交互逻辑单独构建即可。

```sh
pnpm build
node scripts/bake-prepared-nature.mjs bamboo --register
node scripts/bake-prepared-nature.mjs creek --register
pnpm run check:assets
pnpm build
```

侧后方种植或远景材质变化时，先从隔离的离线候选生成六向深度远景，再执行上面的环境准备步骤：

```sh
FLOWER_DELIVERY=../runtime-qa/distance-source pnpm build:offline
node scripts/bake-woodland-distance.mjs ../runtime-qa/distance-source bamboo,creek --register
pnpm build
```

`FLOWER_DELIVERY` 的设置语法随 shell 调整。远景包含六向实际遮挡深度，近处地形、器物与植被仍为真实几何，不能用一张固定视角图替代场景。

只改一景时，只运行对应的生成命令。生成脚本串行启动并关闭临时浏览器，从真实三维场景采集几何、材质和原始纹理，随后在 CPU 上压缩；不会把一张场景截图当作环境。生成会更新 `public/assets/manifest.json` 中的文件哈希和纹理引用。

提交或交付只取素材清单仍引用的资源。制作目录里可能留有旧候选，不能直接把全部未跟踪素材加入提交或公开目录。

## 当前帧绘制

默认画质支持 HDR 时，`FrameRendering` 先绘制不透明物体，再把当帧 HDR 画面供玻璃折射复用，避免为玻璃完整重画一次环境。透明物体沿用同一深度缓冲；最终只进行一次输出色调映射。默认 HDR 颜色使用 RGB 11/11/10 浮点和 2 倍多重采样，减少带宽；不支持浮点目标时保留原生绘制。

桌前携带器物或调整花枝时，复用最多 50 毫秒前从当前真实相机绘制的环境颜色；器物、玻璃和接触阴影仍逐帧更新。缓存与主画面使用相同尺寸、HDR 格式和 2 倍多重采样，避免叶片白边。相机矩阵、投影或画布尺寸变化会立即重画，结束操作后恢复完整绘制；完整画质和原生回退不使用此缓存。树林几何始终参加真实阴影计算，太阳阴影更新与环境颜色重画分散到不同帧，减少瞬间开销。

溪面在不透明阶段完成合成，让玻璃能折射当前的水面。它先使用相同顶点波动写入完全不透明区域的深度，避免重复着色被水遮住的河床；几厘米薄水保留原来的透明过渡。水下折射仍采样完整的真实河床颜色与高度。

岸土准备包只提前计算颜色、凹凸和粗糙度，光照与阴影保持实时。植被按实际距离和米制误差减面，不改变种植位置。侧后方补植使用实际模型的尺寸和落脚点，保留桌前空间。已调色的远景与天空用逆映射保持原有亮度。`?native-render` 是原生绘制的诊断入口，完整画质和不支持 HDR 的设备也保留原生路径。

准备包按空间分组保存实例；剔除以各自真实相机视锥为准，主视角与阴影相机分别判断。溪水的水底仍来自真实几何的颜色、深度图，水波与视角相关倒影仍实时计算。默认画质复用固定眼位的较宽倒影，静止时平滑混合相邻林木采样；眼位、投影或转头超过采样余量时立即更新。水波法线和世界空间折射逐帧计算。运行时按真实操作耗时调节绘制分辨率，最低档维持 0.53，不静默删掉侧后方植被。

## 验证与发布门槛

在完成 `pnpm test`、素材检查与构建后，使用现有五式和桌面拿放脚本验证真实操作。离线验证必须指定独立的 `FLOWER_DELIVERY` 候选目录，避免覆盖正式试玩及旧证据。性能脚本使用网页构建：

```sh
node scripts/review-runtime-startup.mjs startup bamboo
node scripts/review-runtime-startup.mjs startup creek
node scripts/review-runtime-session.mjs bamboo review
node scripts/review-runtime-session.mjs creek review
node scripts/review-runtime-orbit.mjs
node scripts/verify-prepared-fallback.mjs
node scripts/verify-creek-rendering.mjs
node scripts/verify-desk-environment-cache.mjs
```

以上浏览器任务串行执行，每次结束关闭自身浏览器和服务。持续测试默认每景 300 秒，实际鼠标转头、拿起花瓶、移动和放回；记录全部帧耗时、慢帧、画质与设备。截图位于计时之后，不能用截图耗时反推 FPS。

持续测试的帧间隔包含环境刷新和器物绘制的全部耗时；辅助 GPU 查询只包围主视图绘制，启用环境缓存时不包含较早的环境刷新，不用于验收整帧性能。缓存画质脚本比较同一时刻的完整绘制与缓存绘制，并验证尺寸变化后的刷新。

门槛见 `docs/superpowers/specs/2026-11-26-woodland-runtime-design.md`（以该目录实际方案文件为准）。未通过性能或完整环视的候选保留证据，不合并或发布。
