# 动态 App Action

插件可在 `activate(ctx)` 中调用 `ctx.appActions.register()`，把 Action 动态加入 Desktop 的 Action 目录。宿主会先暂存本次 activation 的全部 Action，待 `activate` 和所有注册都成功后一次发布；任一注册失败则整次 activation 回滚。插件重载、停用、卸载或权限被撤销时，宿主会同步注销 Action 并取消执行中的请求。

这使官方 Action 插件可以作为独立制品从插件服务更新，不必等待 Desktop 发版。Desktop 只维护稳定的注册协议、审批和执行边界。

## 权限

插件必须声明并获得两个权限：

```json
{
  "permissions": ["app.actions.register", "app.actionHandler.execute"]
}
```

- `app.actions.register`：向宿主 Action 目录提交可序列化声明。
- `app.actionHandler.execute`：允许宿主把通过校验和审批的请求送到插件 handler。

## 注册示例

```ts
import { definePlugin } from "@vetta-org/plugin-sdk";

export default definePlugin({
  activate(ctx) {
    ctx.appActions.register({
      id: "notes.list",
      title: "List notes",
      summary: "List notes from this plugin",
      usage: {
        target: "Notes stored by this plugin",
        useWhen: "The user wants to inspect this plugin's notes.",
        avoidWhen: "Reading repository files or creating notes.",
        alternatives: "Use file tools for repository files; use the note editor to create notes.",
      },
      effect: "read",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      examples: [{ description: "List ten notes", input: { limit: 10 } }],
      async handler({ input, signal }) {
        if (signal.aborted) throw new Error("Action cancelled");
        return { notes: await listNotes(input.limit ?? 10, signal) };
      },
    });
  },
});
```

插件局部 id `notes.list` 会被宿主公开为 `plugin.<pluginId>.notes.list`，避免插件之间及插件与公共 Action 冲突。`describe` 会返回原始 `inputSchema`，调用方可据此生成输入。

可信官方插件还可声明 `publicId`，例如 `publicId: "general.query"`。若该 id 已被其它实现占用，后到的注册会被忽略并记日志（先注册为准）。普通插件使用 `publicId` 会被拒绝。门控依据宿主生成的 `trustLevel: "official"`，而不是插件 id 或安装来源；当前随包系统插件会获得该级别，远端和本地插件不会。

官方插件需要读写宿主数据时使用 `ctx.official`。该 API 在 SDK 中可见，但普通插件调用会被宿主拒绝；宿主按领域提供窄 API，并通过 `pluginApiVersion` 做主版本兼容检查。`vetta-actions` 当前要求 `^1.1.0`，旧主版本或高于宿主能力的版本不会激活。

## 模型选择边界

`usage` 是可选的模型可见说明；建议每个 Action 声明。提供时，`target`、`useWhen`、`avoidWhen`、`alternatives` 必须都是非空字符串，宿主在 IPC 边界校验并去除首尾空白。`search` 与 `describe` 均返回这四项，因此模型在选择候选时即可知道作用对象、适用场景、排除场景与替代路径，而不只看到参数 Schema。

官方 `vetta-actions` 的所有 Action 都声明使用边界。需要区分 Vetta 自身的项目、主题、插件和定时任务，与用户正在开发的软件：例如开发网页深色模式应编辑项目样式，不应修改 Vetta 主题。查询能力或解释功能也不等于要求创建、修改或执行。已有对话中明确的目标与操作意图可以继续使用，不应反复确认。

检索使用能力名称、关键词、摘要、描述与操作名，不使用内部权限标识，也不索引 `usage`，避免“不要用于安装插件”等排除说明反而成为命中理由。Schema 联合分支中的 `operation` / `type` 常量及枚举仍可用于查找操作。搜索结果只是候选；调用方应核对使用说明，再通过 `describe` 获取参数，不能把命中当作执行指令。缺少 `usage` 时，需从详细说明确认目标，不能推定适用。

这组字段不是授权、可信身份或执行门禁，不能关闭校验、扩大插件权限或替代审批。不要为了判断用户意图先调用写入 Action，把选择错误交给用户在审批框中处理。

## effect 与审批

`effect` 必须是：

- `read`：只读，不触发 Action 审批。
- `write`：修改应用或用户数据；从本地 Action RPC 调用时必须审批。
- `execute`：启动外部执行或有明显副作用；从本地 Action RPC 调用时必须审批。

插件不能绕过审批。宿主根据 `effect` 决定是否审批，并在用户批准后再次使用同一 JSON Schema 校验输入。普通插件固定使用通用审批；可信官方插件可通过 `approval` 引用宿主已有 presentation，并用 `presentationByOperation` 自动选择领域专用界面。operation 映射是宿主执行时的权威选择；调用方只能使用映射结果、通用审批或声明在 `alternativePresentationsByOperation` 中的备选界面。该能力不能注入新组件，也不能把 `write` / `execute` 改为免审批。

## 运行时边界

- `inputSchema` 使用 JSON Schema，由主进程在注册时编译、在执行前校验。
- 输入、示例和返回值都必须可 JSON 序列化；否则宿主返回稳定 Action 错误。
- `timeoutMs` 默认 30 秒，最大 120 秒。
- 超时、调用方取消、插件重载或注销会触发 `signal.abort()`。
- 每次执行都会重新检查插件是否启用以及两个权限是否仍有效。
- Action 按 activation 两阶段发布，不会把注册到一半的声明暴露给 search/describe/run。
- 同一 provider 的 staging 会完整校验后原子替换旧快照；新 activation 失败时继续使用上一版，不先卸载旧版。
- 可选 `assertReady` 在审批前执行；审批 UI 改写输入后会再次执行。适合检查待编辑、删除或取消的实体是否仍存在。
- `assertReady` 或 `handler` 可抛 `PluginAppActionError(code, message, details)`，宿主保留稳定错误码和 JSON 详情。`assertReady` 失败不会展示审批。
- handler 在插件 renderer 运行，可以继续使用闭包中的 `ctx.fs`、`ctx.storage` 等 API；这些 API 各自的权限边界不变。

## 迁移状态

全部内置领域已由随包系统插件 `vetta-actions` 提供；Desktop **不再保留静态领域 Action 实现**。

Catalog 规则：

- 每个 action id **仅一份**实现。
- **先注册为准**；后到的同 id 注册只写主进程日志（`action id conflict, keeping first registration`）并忽略。
- 同一插件 commit 新 activation 时原子替换该 provider 的完整快照，既不被自己的旧注册挡住，也不产生热更新空窗。
- `vetta-actions` 是 required 系统插件，不能被停用或卸载；未激活时 Catalog 返回 `ACTION_RUNTIME_NOT_READY`，而不是返回一个看似正常的空结果。

## 独立发布建议

官方 Action 插件可以由 Desktop 的首装流程放入插件注册表，也可以由插件服务下发更新。更新服务负责版本、灰度、回滚和签名验证；Action Runtime 不承担下载职责，只消费已经通过插件安装链验证并激活的版本。这样发布机制与执行机制解耦，远端协议变化不会扩大 Action Runtime 的可信边界。

产品意义上的“内置 Action 插件”最终应当是**官方托管插件**：可附带 bootstrap 版本，更新包经过签名验证后获得 `trustLevel: "official"`。远端更新服务最后实施；在此之前远端插件不能使用公共 Action id。

当前 Module Federation 插件与宿主共享 renderer JavaScript realm。`ctx.official` 的 trust gate 是宿主能力门控，但不是针对恶意插件的进程级安全隔离；同 realm 的普通插件仍可能尝试访问宿主已暴露的通用 preload API。若要把第三方插件视为不可信代码，必须另建 Worker、utility process 或独立受限 renderer，并让所有宿主能力经过按插件身份授权的消息通道。该隔离属于插件运行时演进，不应以 renderer token 代替。
