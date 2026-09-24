# 文件面板点击性能诊断（2026-09-23）

输入为用户提供的 `Trace-20260923T105803.json`。原始报告不进入仓库；下面只记录性能数字与源码归因。

## 录制中的基线

这是开发环境录制（Vite URL、React 开发构建），不能把绝对耗时当成发布版基准。

| 事件 | 耗时 | 说明 |
| --- | --- | --- |
| 首次较慢点击 | 135.385 ms | EventTiming；点击处理本身 93.918 ms，包含 React 同步工作 |
| 后续文件点击 | 702.311 ms | EventTiming；从 pointerdown 算起为 758.782 ms |
| 最长 Renderer 任务 | 500.659 ms | 包含点击提交、effects 和样式重算；不能与子事件耗时相加 |
| 两次整页样式重算 | 208.335 / 200.758 ms | 分别涉及 2,534 / 2,588 个元素 |
| 随后编辑器挂载任务 | 260.946 ms | CPU 采样中编辑器初始化 effect 累计约 107 ms，并有 focus、destroy 和 React 开发期开销 |
| 性能录制器启动 | 269.446 ms | `CpuProfiler::StartProfiling`，不是产品操作耗时 |

两次最昂贵的 `UpdateLayoutTree` 紧邻的 `ScheduleStyleRecalculation` 调用栈均指向
`rasterizeAppFileIconClass`：第一次在创建图标探针后，第二次在删除探针时。
文件行的 pointerdown 和选中后的 effect 都会预热原生拖拽图标。旧代码只缓存成功后的 PNG，
并发调用会分别向 `<html>` 插入临时节点，之后分别读取 computed style、删除节点。
图标 URL 提取还会误拒绝双引号 URL 中含单引号的合法 SVG，导致转换失败、后续重复预热。

## 修改

- 拖拽图标从宿主已有 Iconify CSS 规则读取内嵌图片，不再挂载探针、读取 computed style 或修改页面 DOM。
  递归读取 layer/media/supports 内的规则，跳过不生效条件和不可读样式表，不引入额外图标数据包。
- 相同图标和尺寸共享正在进行的图片转换，成功后继续复用 PNG；找不到样式或解码失败可以重试。
- 文件预览用现有 `waitForCommittedPaint()` 替代固定 240 ms 延迟。先提交面板，再在绘制机会后挂载内容；
  保留该公共绘制屏障的后台页面处理与 100 ms 超时回退。关闭或重开时取消旧结果，前后文件导航无需再次等待。

这是两个局部实现修正，不改变文件读写、插件图标合同、原生拖拽 IPC 或编辑器文档状态，
无需跨模块重构。活动面板初次渲染和编辑器挂载仍有成本；本次不把未测量的 memo 化或样式调整当作修复。

## 验证与复现

```powershell
node --test apps/desktop/scripts/file-drag-icons.node-test.mjs
bun run test:impact -- apps/desktop/src/renderer/domains/file-explorer/services/rasterize-app-file-icon.ts apps/desktop/src/renderer/domains/file-explorer/services/rasterize-app-file-icon.test.ts apps/desktop/src/renderer/domains/activity-panel/hooks/useFileTabContentModel.ts apps/desktop/src/renderer/domains/activity-panel/hooks/useFileTabContentModel.test.tsx
bun run check
```

浏览器回归在全新 headless Chromium 中运行真实打包的图标服务与真实 CSSOM/Image/canvas，
不连接 Desktop、不读取用户状态。旧实现的预热流程观察到 8 次 DOM mutation；修复后为 0。
测试同时验证并发转换共享、32×32 PNG 的实际像素、每个文件的缓存回调，以及样式晚到/解码失败后的重试。
Hook 回归通过真实 Jotai 入口连续执行打开、等待绘制、下一项、上一项、关闭和重开；
旧代码在绘制后仍未就绪，修复后通过，不依赖墙钟耗时阈值。

未启动或附着用户的 Desktop，也未重新录制整机性能报告。因此，这些结果证明已移除的阻塞机制与固定等待，
不能表述为端到端点击延迟已经从 702 ms 降到某个数值。
