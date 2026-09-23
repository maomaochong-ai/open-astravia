# ADR-0131：Markdown 富内容的隔离渲染与计算预算

## 状态

已接受。扩展 ADR-0116 的默认 Markdown 实现，不改变持久化消息或 Plugin SDK。

## 背景

聊天正文与文件预览已有局部 Markdown 扩展点，但默认只有 GFM 和代码高亮。公式、SVG、HTML 页面需要直接呈现；HTML 还需要支持 JavaScript。把每次流式增量都交给公式引擎或重新加载页面会争用主线程、重复执行脚本，并重置交互状态。原有文件 HTML 预览的宽松沙箱不能作为不可信聊天内容的默认边界。

## 决策

- 在 `theme-ui/markdown` 保留语法、渲染叶子与任务调度的独立职责。聊天与 Markdown 文件预览共享 `remark-math`、原始标记转换和默认代码块配方；原有局部 `components` / `elements` / `codeBlock` 覆盖仍然有效。宿主通过可选 `MarkdownHost` 提供独立预览、图表渲染、图标发现和图片操作；共享组件不直接依赖 Electron、IPC 或业务状态。
- 公式采用 KaTeX，支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 与 math/latex/tex 围栏。引擎在可见公式首次需要时启动的模块 Worker 内执行；输出 HTML + MathML，`trust:false`，公式间不共享宏。单公式最多 8192 字符、500 次宏展开、尺寸上限 20em、计算超时 2 秒后终止 Worker。无效公式保留源码。
- 公式变化按 250ms 尾沿限流，连续输出不会无限推迟。Worker 串行执行、相同输入去重，排队最多 128 个不同任务；结果缓存最多 256 项、合计 100 万 UTF-16 code units（约 2MB），空闲 30 秒释放 Worker。离屏/后台取消订阅，无消费者的任务取消。
- SVG 通过 SVG 图片模式呈现，不把模型 SVG 节点插入宿主 DOM。支持 svg 围栏和完整原始 SVG；原始 SVG 流式更新最多每 500ms 一次。图片模式禁用 SVG 脚本和外部资源。图像错误保留源码。
- HTML 围栏、独立 HTML 块与完整 HTML 文档进入两层 iframe。外层只含受信模板和子框架；两层均不授予 same-origin，静态模式无脚本权限，点击运行会打开独立 Electron 沙盒窗口，正文 iframe 不再授予脚本权限。外层 CSP 限制子页面导航，内层 CSP 禁止外部脚本、请求、子框架、worker、对象、表单和 base URL；只允许内联 CSS/JS、data/blob 图片和 data 字体。不提供宿主消息桥接或文件/会话访问。
- HTML 生成时展示源码，稳定后显示静态预览。脚本运行绑定当前源码，内容改写、离屏、切源码、窗口后台或组件卸载时停止；连续运行 30 秒后停止，可再次运行。运行状态不持久化。Main 的独立计时器可以强制结束同步死循环。独立窗口使用非持久会话、sandbox/contextIsolation、无 Node/preload，禁止网络、导航、下载、权限和新窗口；每个宿主最多两个运行页。没有操作系统级内存配额。
- SVG/HTML 超过 256000 字符时保留源码而不自动预览。加载公式 UI、KaTeX CSS 和富代码块 UI 使用懒加载，普通文本不加载公式引擎。分块冻结不能截断原始 HTML 或多行公式，已提交块继续保持稳定。
- 后续性能完善：Markdown 尾块达到 12000 / 50000 字符时分别按 200 / 400ms 合并解析，已冻结块不占尾块预算，结束与非追加替换立即刷新。继续保留完整 Markdown 上下文，不通过任意截断段落、列表或引用定义换取速度。代码高亮限制输入大小、行数和单行长度，超预算保留完整源码；缓存同时约束条目数与字符串总量。实际预算及独立浏览器基准入口见使用文档。

- Mermaid 引擎仅在 Main 首次图表请求时懒加载其浏览器包，在独立沙盒 renderer 内执行，输出作为 SVG 图像展示。限制 12000 字符、200 条边、8 秒执行时间、8 个排队任务；串行执行并缓存最多 32 项/200 万 UTF-16 单元。禁止将图表 SVG 直接插入宿主 DOM。
- 网页图标采用声明发现和约束后的公开资源下载；新增 parse5 用于 HTML 属性/实体解析、ipaddr.js 用于公开地址分类。DNS 结果固定到请求 socket，逐跳校验，不带凭据；避免通用带会话请求器扩大权限。现有应用代理未用于该直接公开资源通道。缓存、并发、超时均有上限。
- 图片相对路径由 Desktop 结合文档目录解析，读取与保存复用现有文件权限、剪贴板、原生保存对话框及灯箱。`MarkdownHost` 是真实宿主能力边界，`host` 可选以兼容共享包使用者；无宿主时静态 HTML/公式/SVG 保留，交互运行按钮不显示，Mermaid 保留源码。

## 备选方案

- 全局启用 `rehype-raw` 并把 HTML/SVG 插入正文：脚本、样式、ID 与宿主污染面扩大，拒绝。
- 每次 remark 解析同步运行 rehype-katex：实现较短，但流式输出会重复计算并阻塞 UI，选择 Worker 与可见性调度。
- 自动运行所有 HTML：历史列表和流式增量会重复执行脚本，选择静态默认与明确运行。
- 保留可执行 iframe：初版成本较低，但不能中止同步死循环，本轮改为独立窗口。内嵌 WebContentsView 需要同步滚动、遮挡和虚拟列表坐标，选择只把交互运行放到独立窗口，静态预览仍内嵌。

## 迁移与验证

没有数据迁移，消息仍保存原始 Markdown，源码复制保持原文。`MarkdownLabels.rich` 与文件预览的 `labels` 为兼容性可选字段，Desktop 统一从 i18n 提供，其他宿主保留英文默认。旧的独立 HTML 文件预览未改变。

组件流程测试覆盖公式、源码复制、预览切换、停止/恢复、大小限制与限流；Worker 合同测试覆盖去重、串行、超时、取消和宏隔离；独立无头浏览器测试使用真实 iframe 与 Vite 构建的 Worker，验证静态 iframe 的脚本禁用、网络/导航拒绝及 SVG 图片模式。独立 Electron 测试验证预览与宿主进程 ID 不同、交互脚本、宿主/网络隔离、Mermaid 渲染及错误恢复，以及主进程强制中止同步死循环。

参考：[Electron 窗口隔离](https://www.electronjs.org/docs/latest/api/browser-window)、[强制终止 renderer](https://www.electronjs.org/docs/latest/api/web-contents#contentsforcefullycrashrenderer)、[Mermaid 配置](https://mermaid.js.org/config/configuration)、[KaTeX 安全选项](https://katex.org/docs/security)、[iframe 沙箱](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。
