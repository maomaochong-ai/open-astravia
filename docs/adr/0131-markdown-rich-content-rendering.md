# ADR-0131：Markdown 富内容的隔离渲染与计算预算

## 状态

已接受。扩展 ADR-0116 的默认 Markdown 实现，不改变持久化消息或 Plugin SDK。

## 背景

聊天正文与文件预览已有局部 Markdown 扩展点，但默认只有 GFM 和代码高亮。公式、SVG、HTML 页面需要直接呈现；HTML 还需要支持 JavaScript。把每次流式增量都交给公式引擎或重新加载页面会争用主线程、重复执行脚本，并重置交互状态。原有文件 HTML 预览的宽松沙箱不能作为不可信聊天内容的默认边界。

## 决策

- 在 `theme-ui/markdown` 保留语法、渲染叶子与任务调度的独立职责。聊天与 Markdown 文件预览共享 `remark-math`、原始标记转换和默认代码块配方；原有局部 `components` / `elements` / `codeBlock` 覆盖仍然有效。宿主只提供翻译与原有文件/URL 操作。
- 公式采用 KaTeX，支持 `$...$`、`$$...$$` 与 math/latex/tex 围栏。引擎在可见公式首次需要时启动的模块 Worker 内执行；输出 HTML + MathML，`trust:false`，公式间不共享宏。单公式最多 8192 字符、500 次宏展开、尺寸上限 20em、计算超时 2 秒后终止 Worker。无效公式保留源码。
- 公式变化按 250ms 尾沿限流，连续输出不会无限推迟。Worker 串行执行、相同输入去重，排队最多 128 个不同任务；结果缓存最多 256 项、合计 100 万 UTF-16 code units（约 2MB），空闲 30 秒释放 Worker。离屏/后台取消订阅，无消费者的任务取消。
- SVG 通过 SVG 图片模式呈现，不把模型 SVG 节点插入宿主 DOM。支持 svg 围栏和完整原始 SVG；原始 SVG 流式更新最多每 500ms 一次。图片模式禁用 SVG 脚本和外部资源。图像错误保留源码。
- HTML 围栏、独立 HTML 块与完整 HTML 文档进入两层 iframe。外层只含受信模板和子框架；两层均不授予 same-origin，静态模式无脚本权限，用户点击运行后才授予 `allow-scripts`。外层 CSP 限制子页面导航，内层 CSP 禁止外部脚本、请求、子框架、worker、对象、表单和 base URL；只允许内联 CSS/JS、data/blob 图片和 data 字体。不提供宿主消息桥接或文件/会话访问。
- HTML 生成时展示源码，稳定后显示静态预览。脚本运行绑定当前源码，内容改写、离屏、切源码、窗口后台或组件卸载时停止；连续运行 30 秒后停止，可再次运行。运行状态不持久化。iframe 沙箱不是 CPU 硬隔离：同步死循环可能阻塞 renderer，30 秒计时器仅对事件循环仍能调度的脚本有效，不声称解决任意恶意脚本的资源耗尽。
- SVG/HTML 超过 256000 字符时保留源码而不自动预览。加载公式 UI、KaTeX CSS 和富代码块 UI 使用懒加载，普通文本不加载公式引擎。分块冻结不能截断原始 HTML 或多行公式，已提交块继续保持稳定。

## 备选方案

- 全局启用 `rehype-raw` 并把 HTML/SVG 插入正文：脚本、样式、ID 与宿主污染面扩大，拒绝。
- 每次 remark 解析同步运行 rehype-katex：实现较短，但流式输出会重复计算并阻塞 UI，选择 Worker 与可见性调度。
- 自动运行所有 HTML：历史列表和流式增量会重复执行脚本，选择静态默认与明确运行。
- 为每块 HTML 启动独立 Electron WebContents 并提供强制终止：CPU 隔离更强，但会引入新的 Main/IPC、进程池与跨平台资源生命周期。当前提供无宿主能力的浏览器沙箱，硬 CPU 隔离作为明确剩余限制，不使用计时器冒充进程边界。

## 迁移与验证

没有数据迁移，消息仍保存原始 Markdown，源码复制保持原文。`MarkdownLabels.rich` 与文件预览的 `labels` 为兼容性可选字段，Desktop 统一从 i18n 提供，其他宿主保留英文默认。旧的独立 HTML 文件预览未改变。

组件流程测试覆盖公式、源码复制、预览切换、停止/恢复、大小限制与限流；Worker 合同测试覆盖去重、串行、超时、取消和宏隔离；独立无头浏览器测试使用真实 iframe 与 Vite 构建的 Worker，验证交互、宿主访问隔离、网络/导航拒绝及 SVG 图片模式。

参考：[KaTeX 安全选项](https://katex.org/docs/security)、[iframe 沙箱](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。
