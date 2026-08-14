# Vetta UI Design：第三方依赖归设计所有，`x.vetd/` 是一个真实 npm 工程

设计文档可以声明并安装自己的 npm 依赖：`x.vetd/package.json` 是事实源，`x.vetd/node_modules/` 是生成物，agent 通过 `vetd_install` 装包。共享引擎从「提供全部依赖」降级为「编译宿主 + 核心运行时单例」——它继续锁 react / react-dom / react-router 与 Tailwind/Iconify，但不再决定一份设计能用什么库。

这推翻了 ADR-0053 的两条结论：「设计文档永不携带 node_modules，只存源码」和「新建 .vetd 必须秒开、零 npm install」。

理由：设计稿的定位从「能点的效果图」变成**落地稿**——目标是可一键部署、后续能接入数据层的真实前端工程。这个目标下，「能用哪些库」不可能由引擎预先穷举：图表、Markdown 渲染、富文本、日期选择、动效，每一类都有多个不等价的实现，而选型属于这一份设计的产品决策，不属于引擎。原方案里 agent 遇到引擎没有的库只有两条路——手搓一个劣化版本，或者放弃需求，两条都在把落地稿降级回效果图。

## Considered Options

- **A 扩充引擎内置白名单**：把高频库预装进引擎模板。不动架构、零安装延迟，但白名单是穷举，长尾需求永远接不住；且每个用户都要为自己从不使用的库付出磁盘和安装时间。
- **B 设计级依赖（选定）**：`x.vetd/` 自带 package.json + node_modules，引擎只保留编译能力与运行时单例。
- **C CDN / esm.sh 运行时 import**：与「禁远程资源」的既有规则、截图确定性和离线可用直接冲突，且产物不是可部署工程。

## Consequences

- **解析与预构建不需要任何引擎配置**（已在 vite 7.3.6 + 真实引擎上验证）：vite 对裸 import 从「引入者所在目录」做 node 解析，设计源码就在 `x.vetd/` 里，`x.vetd/node_modules/` 天然命中；依赖扫描不到的包会在首次 import 时被自动发现并预打包，CJS 包因此同样可用。引擎 `vite.config.mjs` 里那组 alias 是反向问题的解——react 装在**引擎**里，从设计源码走 node 解析够不到，才必须钉死。
- **react 单例由既有 alias 保证**：第三方库的 peer react 会在设计目录里落一份副本，但 rollup alias 对 `react` 及其子路径（`react/jsx-runtime`）全部短路到引擎那一份。实测 react-markdown、recharts 与 react 共用同一个预打包 chunk。设计的 package.json 仍把 react 三件套按引擎版本写死，让 peer 校验干净、并让这个目录能被外部工具直接构建。
- **零 install 秒开让位**：新建设计仍然零安装（scaffold 只写 package.json，不装），但**装过包的设计、以及从 `.vetdz` 导入的设计**首次打开需要一次 `npm install`。安装走托管 npm 环境（镜像 + 共享缓存，见 `command-environment.ts`），并复用引擎已有的 `EngineProgress` 进度 UI。
- **`.vetdz` 分享包带 package.json + package-lock.json，不带 node_modules**：`export-design.ts` 与 `bundle-paths.ts` 的排除名单里 `node_modules/` 早已就位，无需改动。接收方打开时自动补装。
- **引擎目录监听必须排除 node_modules**：`vetdWatchDesign` 原本递归遍历整个设计目录来做文件集快照。实测装两个库后目录从 4 个文件涨到 7350 个，每次源码保存都要多走一趟 15ms 的遍历，且各平台 `fs.watch` 对 node_modules 写入的事件量差异极大（macOS FSEvents 合并，Linux inotify 逐文件）。遍历与监听均跳过 `node_modules`。
- **Tailwind 不受影响**：`@source "<designRoot>"` 的自动内容检测本身就跳过 node_modules，实测样式表仍是 7.5KB、不含任何库内类名，不需要 `@source not`。
- **`uninstalled-import` 检查从静态名单改为动态**：判据变成「引擎内置 ∪ 设计 package.json 的 dependencies」。这条必须与安装同时落地——装完包却仍被报「引擎没有这个包」，agent 的反应是去删掉本来正确的代码，比不检查更糟。
- **安装不加限制**：`npm install` 不带 `--ignore-scripts`，与用户在本地开发时的行为一致。代价是被诱导安装的恶意包可以在 postinstall 执行任意代码；这与「用户让 agent 在自己项目里装依赖」是同一个信任层级，不在插件边界上单独收窄。
- **一键部署的前置条件就此具备**：`x.vetd/` 成为一个能被外部 `npm install` 的工程，剩下的只是把引擎的 `vite.config.mjs` / `index.html` / `src/main.tsx` eject 进去，可作为后续「导出为项目」的一步实现。
