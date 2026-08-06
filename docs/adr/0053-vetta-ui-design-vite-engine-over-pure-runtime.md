# Vetta UI Design：frame 走 vite 工程路线，而非纯浏览器运行时

「Vetta UI Design」系统插件的 frame 需要 Tailwind 与图标能力。我们决定 frame 的源码形态是 **TSX（React 组件）**，由插件托管的**共享引擎**（单一锁版本的 vite + React + Tailwind v4 + @iconify/tailwind4 模板工程，node_modules 预装）编译，每个打开的 .vetd 起一个 vite dev server，画布 iframe 指向 localhost 获得真 HMR（<100ms、不丢状态）——而不是「frame = 静态 HTML + `@tailwindcss/browser` 运行时」的零构建路线。

理由：设计稿的天花板诉求（组件复用、npm 生态动效、产出物直接是可交付的前端代码）只有工程路线买得到；纯运行时路线迟早撞墙，届时 .vetd 格式与 agent skill 全部重做。Onlook 验证过该模型成立。

## Considered Options

- **A' 纯运行时**：frame = HTML，`@tailwindcss/browser` 页内即时编译 + 插件内嵌 @iconify/json 按需生成图标 CSS。零 Node、零安装、秒开、失败面最小，但无 TSX/组件化/npm 生态，复杂动效靠手写 JS。
- **B1 一次性构建**：现有 `ctx.command.run` 每次变更跑 `vite build`（~1.5-3s 上屏，无局部热替）。不改宿主，可作降级兜底。
- **B2 dev server + 真 HMR（选定）**：需扩宿主插件 SDK 的长驻进程能力（现有 `command.run` 是一次性 execFile、~120s 上限，跑不了 dev server）。

## Consequences

- 目标用户是**普通用户为主**，因此两条生死线：① 引擎随 App 安装包预置（对齐托管运行时「内置 vendor 主路径」哲学；常用图标 set 内置、罕见 set 按需下载一次），新建 .vetd 必须秒开、零 npm install；② 构建/进程失败面要被工程化兜住（锁版本消灭依赖解析、端口与进程生命周期由宿主 SDK 管理）。
- 依赖宿主两项能力：托管 Node 运行时；**新增**插件长驻进程 SDK（含生命周期与端口管理），需另行设计。
- 设计文档（.vetd + 旁挂目录）**永不携带** node_modules 与构建配置，只存源码——引擎升级即全体设计升级。
- 选中 DOM → 源码定位：引擎 dev 模式经 JSX 插桩注入 `data-source`（文件:行号），attach 载荷 = 精确坐标 + 语义信息（DOM 路径/序号/class/文本）；生产导出不注入。
- frame 曾设想为「一个独立可开的 HTML 文件」；本决定后该可移植性由打包态（zip 内含 dist 构建快照）承接。
