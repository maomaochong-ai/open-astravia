# App Actions 开发说明

## Action 的作用

App Action 是 agent 调用 Vetta Desktop 能力的受控 RPC 边界。主进程只保留：

- Catalog / Runtime / 本地 Action RPC
- 审批 broker
- 插件动态注册（`PluginActionService`）

**业务 Action 实现由插件提供**（官方系统插件 `vetta-actions` 与第三方插件），不再在 `app-actions/*` 下维护静态领域实现。

## 注册与冲突

- 插件通过 `ctx.appActions.register()` 提交声明；官方插件可用 `publicId` 占用稳定 id。
- Catalog **每个 action id 仅保留一份实现**。
- **冲突策略：先注册为准**；后到的同 id 注册会被忽略，并在主进程日志中记录
  `register: action id conflict, keeping first registration`（含双方 providerId / title）。
- 插件 activation 使用 `begin → stage → commit/abort`：commit 会先完整校验 staging，再以 provider 快照原子替换旧 activation；失败时旧版本继续服务，不出现空目录窗口。

## 运行时边界

- JSON Schema 校验、write/execute 审批、超时、取消、结果序列化由宿主强制执行。
- handler 在插件 renderer 运行；renderer 不可用时返回 `PLUGIN_ACTION_UNAVAILABLE`。
- 写操作对 `local-server` 来源走审批；`assertReady` 失败不得弹审批。
- 公共内置 Action 依赖 required 系统插件 `vetta-actions`；该 provider 未就绪时，Catalog 必须返回 `ACTION_RUNTIME_NOT_READY`，不能把空目录伪装成正常结果。

## 新增 / 修改 Action

1. 改官方插件 `packages/plugins/presets/vetta-actions`（或独立官方 Action 插件）。
2. 需要宿主数据时扩展 `ctx.official`（`plugin-sdk` + `plugin-official-api.ts`），禁止插件任意 IPC。
3. 写操作复用已有审批 presentation id；不能注入新审批组件。
4. 文档见 `docs/plugin/app-actions.md` 与 `docs/adr/0045-plugin-provided-app-actions.md`。

## 验证

- 插件激活后 `vetta action search` 能列出对应 id。
- 两个插件抢同一 `publicId` 时，后者只打日志，前者仍可 run。
- 插件热更新 activation 失败时，旧版本仍可 search/describe/run；成功时同一时刻切换整组 Action。
- 修改 desktop 代码后：`bun run check`。
