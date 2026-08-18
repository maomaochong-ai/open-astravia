# ADR-0045：由插件动态提供 App Action

## 状态

Accepted

## 背景

Desktop 的 App Action 曾由 `apps/desktop/src/main/app-actions` 静态注册，只能随应用升级。Action 与插件都包含“声明能力、运行处理器、管理生命周期和权限”的共同模型。官方内置 Action 插件又可以由独立服务发布，因此不应把 Action 内容更新继续绑定到 Desktop 版本。

## 决策

增加 `ctx.appActions.register()`：

1. 插件提交 JSON 可序列化的 Action 元数据、JSON Schema、effect 和 renderer handler。
2. 主进程把声明包装为 `ActionDefinition` 并注册到唯一的 `AppActionCatalog`。**每个 action id 仅保留一份实现**；冲突时 **先注册为准**，后到者写入日志并忽略。
3. 主进程拥有 JSON Schema 校验、权限复查、write/execute 审批、超时、取消和结果序列化。
4. renderer 只执行已经通过宿主边界的 handler。插件 Action activation 使用 `begin -> stage -> commit/abort`：全部声明注册成功后，Catalog 以 provider 快照原子替换旧 activation；失败时丢弃 staging 并保留上一版，不发布半套 Action，也不产生热更新空窗。
5. 第三方插件公开 id 固定为 `plugin.<pluginId>.<localId>`。只有宿主判定为 `trustLevel: "official"` 的插件才可通过 `publicId` 占用稳定公共 id。信任级别由宿主生成，不能由插件 manifest 或用户可编辑的注册表声明。
6. **不再维护静态领域 Action 实现**；业务能力由随包系统插件 `vetta-actions`（及后续官方 Action 插件）提供。Desktop 只保留 Catalog / Runtime / 审批 / 插件注册协议。
7. 插件下载、签名、灰度与回滚继续归插件分发链负责，不写入 Action Runtime。
8. `vetta-actions` 覆盖全部内置 App Action 领域。插件通过受信任的 `ctx.official` 领域能力读写宿主数据。
9. 官方 Action 插件未来改为独立更新时，分发层必须把签名验证结果映射为 `trustLevel: "official"`；不能仅凭远端来源或插件 id 放宽覆盖权限。远端更新服务最后实施。
10. `write` / `execute` 的审批与二次校验仍由宿主强制执行。普通插件只能使用通用审批；官方插件可以声明宿主已有的 approval presentation 及 operation 映射，以保留领域专用、可编辑的审批体验，但不能注入组件或声明免审批。
11. 插件 Action 可声明 `assertReady`，宿主会在审批前和审批输入被编辑后调用；失败通过结构化 `PluginAppActionError` 返回稳定错误码与详情，不展示审批。该阶段与 `handler` 使用同一取消、超时、权限和 activation 生命周期。
12. `vetta-actions` 是 required 系统插件：宿主不允许停用或卸载；公共 Action provider 未就绪时 Catalog 返回结构化 `ACTION_RUNTIME_NOT_READY`，不把空目录当作成功结果。
13. manifest 的 `pluginApiVersion` 在安装发现阶段由宿主校验。宿主在同一主版本内向后兼容，插件不能要求高于宿主的 API 版本；`vetta-actions` 从 `^1.1.0` 起依赖本 ADR 的完整宿主能力。

## 原因

- Action 目录必须在主进程，才能让 CLI/RPC 在不信任 renderer 返回元数据的情况下统一发现和审批。
- handler 留在插件 renderer，可复用现有插件 SDK 与更新生命周期，无需为每个 Action 扩展静态 IPC。
- JSON Schema 是跨进程、跨版本的稳定声明格式；Zod 函数不能序列化。
- 命名空间阻止第三方插件覆盖宿主或其它插件 Action；显式可信门控允许官方插件保持既有公共契约。
- 迁移完成后去掉静态双实现，避免两套逻辑漂移；冲突 first-wins 行为简单可预测，并用日志暴露抢 id 问题。
- 下载与执行解耦后，官方插件可以独立更新，同时宿主的安全边界保持稳定。

## 后果

- Desktop 仍需随协议演进更新 SDK，但新增或修改具体 Action 不再需要发版。
- `gui-renderer` Action 依赖主窗口 renderer；renderer 不可用时返回 `PLUGIN_ACTION_UNAVAILABLE`。
- 普通插件只提供通用审批；官方插件可以引用宿主已有审批 presentation，但不能注入审批组件或声明免审批。
- **不再有静态 fallback**：官方 Action 插件未激活或激活失败时，对应公共 id 从目录消失，直到插件恢复。
- 当前随包系统插件由宿主标记为 `trustLevel: "official"`；远端和本地插件分别为 `community` 与 `local`，均不能使用 `publicId`。来源与信任门控已经解耦，但远端签名验证尚未实施。
- 当前插件与宿主共享 renderer JavaScript realm，因此 `ctx.official` 门控不是恶意代码隔离边界。要把第三方插件作为不可信代码执行，后续必须迁移到 Worker、utility process 或独立受限 renderer，并通过携带宿主侧插件身份的消息通道授权；renderer token 不能建立该边界。
