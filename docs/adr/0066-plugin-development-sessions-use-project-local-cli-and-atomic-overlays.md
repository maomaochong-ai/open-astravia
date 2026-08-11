# ADR-0066：插件开发会话使用项目本地 CLI 与原子 overlay

## 状态

Accepted

## 背景

Desktop 的插件工作台和未打包开发启动都需要 React/CSS HMR，以及 manifest、locale、agent 资源的定向重载。插件工程可能位于 monorepo preset、external 或仓库外，并拥有不同但协议兼容的 Vite 配置与 `@vetta-org/plugin-vite` 版本。

旧流程先把插件资源根切到工程目录，再解析并启动开发 CLI。CLI 缺失、exports 不兼容、启动退出或 ready 超时时，宿主已经发布了半生效的 dev overlay；批量启动又用一个 `Promise.all` 汇总彼此独立的会话，使单个失败看起来像全局失败。

## 决策

1. 宿主始终解析插件工程模块图中的 `@vetta-org/plugin-vite/cli` 公共子路径，并用 Node 直接执行解析出的文件。不得回退到宿主或 monorepo 根工具包，也不得通过 `bunx` 隐式下载工具版本。
2. 插件稳定 installed/staging 快照与开发会话状态分离。`starting` 和启动期 `error` 只发布诊断状态；开发服务器必须先验证 manifest 可访问，并通过 Vite client transform 递归验证插件工程目录内的入口模块图。只有随后 CLI 发出协议版本、插件 id 和本机同源 URL 均通过校验的 `ready`，宿主才一次性提交源码 dev overlay、刷新 Agent 配置并定向替换 activation。React 等宿主共享依赖不属于工程本地模块图，仍由 Renderer 在真实 share scope 中完成加载和 activation 校验。
3. ready 前失败保留稳定快照。ready 后开发进程异常退出时立即撤下不可达的 localhost overlay、回退稳定快照，并按 250ms、1s、3s 有限重启；重试耗尽后保持稳定快照与错误诊断。Vite 编译或资源 watcher 错误属于可恢复错误，只标记状态，不杀仍存活的服务器。
4. 多插件会话彼此隔离。默认 tenant 的全部 preset 仍可启用热更新，但冷启动最多四路并发，timeout 从实际 spawn 开始计算；批量入口逐插件汇总成功与失败，单个项目失败不取消或掩盖其它项目。
5. 开发 overlay 仅存在于未打包 Desktop 的内存中，不修改用户插件注册表、系统插件 staging 或发布 zip。未安装的显式 external 在 ready 前保持 disabled，ready 后才成为本会话可用的临时插件。
6. App 退出、用户关闭热更新、插件停用或卸载时，宿主继续统一回收开发子进程、重启定时器和 overlay。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 使用宿主自己的 `plugin-vite` | 会掩盖插件工程缺依赖，并可能用不兼容版本执行其 Vite 配置 |
| 执行工程 `node_modules/.bin` 或 `bunx vetta-plugin` | shim 形态跨平台不同，`bunx` 还可能下载并执行非锁定版本 |
| 给包根增加 CommonJS `require` 条件 | CLI 只是 ESM 可执行入口，伪装包根支持 CommonJS 会扩大错误合同；明确的 `./cli` 子路径更准确 |
| 单进程托管全部插件的 Vite server | 不同项目的依赖与配置需要隔离，当前也没有足够收益抵消共享进程带来的版本和故障耦合 |
| ready 前先切源码以显示 starting | 会让不可用候选污染正在运行的插件；状态展示不应改变资源和权限事实源 |

## 后果

- `@vetta-org/plugin-vite` 的 `./cli` 成为 Desktop 与外部工具可依赖的公共子路径，移除或改名需要协议迁移。
- 系统插件常态仍遵守 ADR-0024 的 staging-only 合同；源码访问是未打包 Desktop、握手成功、纯内存且可回滚的开发期例外。
- Desktop 必须保留项目本地 CLI 解析、ready/URL 校验、失败回滚、批量隔离和重启生命周期测试。
- `plugin-vite` 必须保留开发入口模块图探针，并区分普通 stylesheet 请求与 `?raw` / `?url` / `?inline` CSS 资源模块；后者不得进入 PostCSS scope 转换。
- 仓库外热更新依赖包含该公共 CLI 与协议实现的 `@vetta-org/plugin-vite` 版本先发布，再由脚手架和 Desktop 对外声明。
