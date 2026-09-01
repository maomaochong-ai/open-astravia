# ADR-0098：插件 CLI Provider 与能力详情设置 Slot

- 状态：已接受
- 日期：2026-09-01

## 背景

部分外置能力的上游产品面本来就是面向 Agent 的 CLI。把这类 CLI 再包装成 Vetta Action、MCP 或自定义 Tool，
会复制命令协议、上游 Skills 和认证流程，也会让市场插件承担不属于它的执行抽象。另一方面，仅在详情文案中给出
手工命令无法展示启用后的真实安装进度，也无法承接扫码配置等交互。

现有 `plugin.json#commands` 表达的是插件 Renderer 自己可执行的命令白名单及用户开关，不表达插件启用时由宿主准备的
外部依赖；全局 UI Slot 也不适合承载某个能力详情页内的安装与配置状态。

## 决策

1. Plugin manifest 新增 `providers.cli[]`。每个 Provider 声明稳定 id、Agent 最终使用的裸命令名、无 Shell 的探测 argv，
   以及无 Shell 的安装命令与 argv。宿主只执行声明内容，不把安装器注册成 Agent Tool，也不复用 `commands` 授权开关。
2. 插件启用时，Desktop 主进程先探测可执行文件；缺失时运行安装器，再次探测确认。状态按
   `checking → installing → verifying → ready` 或 `failed` 发布，输出使用有上限的尾部缓冲。并发请求按
   `pluginId/providerId` 合并。停用、卸载和重载会终止宿主持有的安装与子进程，但不会卸载已安装的全局 CLI。
3. 插件声明了 CLI Provider 时，在所有 Provider 进入 `ready` 前，宿主不向 Coding Agent 发布该插件的静态或动态
   Agent 贡献。验证完成后刷新现有 Plugin Runtime 快照。Agent 仍通过原有 Shell 直接调用 CLI；Provider API 只供插件
   Renderer 展示状态、重试及驱动上游原生配置流程。
4. Plugin SDK 新增 `ctx.cliProviders`，按 manifest Provider id 提供状态订阅、重试、一次性运行和长驻进程句柄。
   宿主始终从 manifest 解析实际 executable，插件调用方只能传 argv，不能替换命令。
5. Plugin UI 新增 `registerAbilityDetailSlot`。贡献必须明确目标 ability slug，宿主固定将其渲染在详情 Header 与静态营销
   内容之间，并传递 installed/enabled 状态。该 Slot 只在匹配能力详情中出现，不升级为全局浮层。
6. 二维码由宿主公共 UI API从上游 CLI 输出的完整不透明 URL 生成。插件不得重建、缩短或修改认证 URL；同时提供外部浏览器
   打开入口。凭据的存储与脱敏继续归上游 CLI，Vetta 不复制 App Secret。

## 边界

- CLI Provider 是插件依赖提供者，不是 Vetta Action、MCP、Agent Tool 或新的 Agent 安全门禁。
- 安装从用户确认启用后开始；安装进度是可见且可重试的，不伪装成静默安装，也不使用虚假百分比。
- 本决策不为任意市场能力开放 Shell 脚本。manifest 命令字段仍是裸 executable + argv，入口经过现有跨平台进程启动器。
- 用户停用插件不会回滚本机 CLI 或上游凭据；再次启用优先探测并复用已有安装。

## 兼容与验证

该公共合同将 Desktop Plugin API 提升到 `1.4.0`。旧插件不声明 Provider，生命周期和 Agent 贡献保持不变；旧注册表缺少
`cliProviders` 时按空数组读取。依赖新合同的插件由既有 `pluginApiVersion` 兼容检查拒绝安装到旧宿主。

测试覆盖 manifest 结构与重复 id、探测/安装/验证状态转换、安装输出、已存在 CLI 的快速路径、Agent 贡献就绪门控、
详情 Slot 的 slug 匹配和状态 Props，以及市场包身份与双语展示资源。
