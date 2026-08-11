# TypeBox、Zod 与运行时校验策略

## 结论

本方案不选择“TypeBox 或 Zod”作为全局唯一校验库，而是按边界分工：

- Pi Extension 的 Tool Schema 作者兼容使用 `typebox@1.3.x`，只存在于 `pi-compat` loader/module facade 边界。
- Vetta native Extension 继续使用 `@sinclair/typebox@0.34`，本项目不借兼容工作迁移它。
- 两套 TypeBox Schema 都在发布前转换为 JSON-safe 的 plain JSON Schema；canonical contribution 和 Runtime 不携带任一版本的 `TSchema` 类型。
- Tool 参数继续使用 JSON Schema validator 校验，并按 Schema dialect 建立明确的 validator profile。
- Zod 只用于需要 default、preprocess、transform、跨字段 refine 的人工配置边界；第一阶段没有这样的新配置时，不新增 Zod Schema。
- 包含函数的 Extension registration、event handler 和 action callback 不能靠 JSON Schema 表达，使用窄的运行时 guard，再编译为内部强类型对象。

因此，需要引入的是一个**隔离的 TypeBox 1 兼容依赖**，不是把 Vetta 全部 Schema 栈切换到 TypeBox 1，也不是再用 Zod 复制一次 Tool Schema。

## 先补 Vetta 原生 validator port

TypeBox 1 不能成为修改 Runtime Tool 执行器的理由。应先给 product-neutral `RuntimeToolDefinition` 增加可选 `validateInput(input)`，并透传到 Agent engine 已有的同语义能力；Vetta native Extension 先用该 Port 实现 `normalizeInput -> TypeBox/JSON Schema validate` 并通过测试。

完成这一步后，Pi adapter 只是为 TypeBox 1 Schema 编译 Ajv validator，并把 Pi `prepareArguments` 映射到 native `normalizeInput`。`runtime-core`、Agent engine 和 Tool policy 都不会出现 Pi 类型或 TypeBox 1 import。详细模块所有权见 [Vetta 原生能力先行方案](07-vetta-native-first.md#n2native-tool-contract)。

## 为什么需要 TypeBox 1 facade

当前 Pi 固定版本在 `coding-agent` 中依赖 `typebox@1.3.7`，Extension 的 `ToolDefinition.parameters` 直接接受该包的 `TSchema`。Pi loader 还把以下 specifier 映射到同一 TypeBox 1 实例：

```text
typebox
typebox/compile
typebox/value
@sinclair/typebox
@sinclair/typebox/compile
@sinclair/typebox/value
```

这不仅是类型层兼容。Extension 可能在 factory 或 Tool 实现中调用 `Value.*`、`Compile` 等运行时代码。如果只提供假的类型声明，模块会在执行时失败。

建议在 `@vetta/coding-agent` 增加与目标兼容 profile 对齐的精确 `typebox` minor 依赖，并由 virtual module facade 暴露。依赖升级必须通过 compatibility corpus 后才能调整；不要用宽范围表达“所有未来 TypeBox 1 都兼容”。

Pi legacy namespace 中的 `@sinclair/typebox` 也应在 **Pi loader 内**指向 TypeBox 1 facade，以复现 Pi 当前行为。Vetta native loader 仍把 `@sinclair/typebox` 指向现有 0.34 实例，两者不能共享 specifier map。

## Canonical Schema 边界

建议 canonical contract 使用只读 JSON 值，而不是任一 TypeBox 类型：

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type CanonicalJsonSchema = Readonly<Record<string, JsonValue>>;

interface CanonicalToolSchema {
  readonly dialect: "draft-07" | "2019-09" | "2020-12" | "compatible-subset";
  readonly schema: CanonicalJsonSchema;
  readonly sourceLibrary: "pi-typebox-1" | "vetta-typebox-0.34" | "plain-json-schema";
}
```

Tool 参数的顶层 Schema 必须是对象 Schema，以满足模型 Tool contract 和 Vetta 当前 Runtime 输入合同；嵌套位置仍可包含 JSON Schema boolean 值。Pi Extension 若注册非对象顶层 Schema，应在发布前得到 `PI_COMPAT_INVALID_SCHEMA`，不能等 Provider 拒绝请求。

具体 draft 不能通过 npm 包名猜测。Normalizer 应检查 `$schema` 和使用到的关键字；未声明 draft 时，按固定 compatibility profile 选择，而不是跟随全局 Ajv 默认值。发布前要完成：

1. 只遍历 enumerable own string keys，忽略 TypeBox 的 symbol-keyed authoring metadata；检测循环引用、函数值、BigInt、getter 和其他非 JSON 值；
2. 复制为无原型或冻结的 JSON-safe 数据，避免发布后被 Extension 修改；
3. 限制最大深度、节点数和字符串长度，防止恶意或意外的超大 Schema；
4. 检查 `$id`、`$ref` 和自定义关键字；默认只允许可解析的本地引用，不进行网络获取；
5. 编译 validator，并用正例和反例探测一次；
6. 保存归一化 Schema 与 dialect metadata，供 Runtime 和诊断使用。

若 Pi Schema 使用 Vetta validator 不支持的关键字，兼容状态应为 `unsupported` 或显式 `adapted`，不能删掉关键字后继续宣称 lossless。

## Ajv 使用建议

仓库已经依赖 Ajv 8 和 `ajv-formats`。建议建立 `SchemaValidatorRegistry`，按 dialect 缓存 validator，而不是让每个 adapter 自行 `new Ajv()`：

```text
SchemaValidatorRegistry
  - draft-07 profile
  - draft-2020-12 profile
  - compatibility subset policy
  - compiled validator cache keyed by canonical schema hash
```

是否需要 `Ajv2020` 由 corpus 中真实 Schema 决定，但这个决定必须在 profile 中固定并测试。错误输出统一投影为 Vetta 的参数错误，不把 Ajv 内部对象直接暴露给 Extension 或模型。

Vetta native Tool 先定义 `normalizeInput`，Pi `prepareArguments` 只做名称和错误投影。顺序固定为：

```text
raw model arguments
  -> JSON/object boundary check
  -> native normalizeInput（Pi 来源映射 prepareArguments）
  -> canonical schema validation
  -> execute
```

normalize/`prepareArguments` 抛错与 Schema 校验失败使用不同错误码；它不能绕过最终校验。

## Zod 是否引入

`@vetta/coding-agent` 已经依赖 Zod，但本兼容层不应因为“类型判断更方便”而无差别使用它。

适合 Zod 的场景：

- 新增 `piCompatibility` 对象配置，包含旧字段迁移、默认值、字符串到枚举转换和跨字段约束；
- 读取不可信 JSON/YAML 设置并需要给用户聚合展示多个配置错误；
- Provider 配置中存在必须规范化的 discriminated union，且不能由现有 TypeBox/JSON Schema 合同复用。

不适合 Zod 的场景：

- Tool 参数：事实源已经是 Extension 提供的 JSON Schema；
- Extension factory、handler、action callback：值中包含函数，Zod Schema 很快会退化成大量 `z.custom`；
- canonical contribution：它由已验证 adapter 在进程内构造，重复 parse 只会制造第二份合同；
- Pi event payload：应该由 event projector 从 Vetta 强类型事件构造，而不是再 parse 自己刚构造的对象。

第一阶段建议只增加 `piCompatibility?: "off" | "strict" | "host-aware"` 枚举，不为它新增 Zod。未来若升级为复杂对象，再复用配置层既有 Zod 入口，避免 compat 自建配置系统。

## 边界与校验责任

| 输入边界 | 事实源 | 校验方式 | 失败时机 |
| --- | --- | --- | --- |
| package `pi` resource entries | package manifest | 复用现有 TypeBox manifest Schema | discovery，执行模块前 |
| resolved extension path | filesystem/trust policy | 路径、来源、project trust 检查 | import 前 |
| default export/factory | loaded module | `typeof === "function"` 与签名 facade | factory 调用前 |
| `registerTool` 等 registration | 第三方代码 | capability-specific runtime guards | 写入 draft 前 |
| Tool Schema | TypeBox/plain JSON | JSON-safe normalize + dialect validator compile | compile/publish 前 |
| Tool arguments | 模型输出 | canonical JSON Schema validator | execute 前 |
| handler 返回值 | 第三方代码 | 每事件专用 result guard/folder | 影响后续 handler 前 |
| Provider config | 第三方代码 | 分阶段专用 Schema/guard | publish 前 |
| canonical contribution | 内部 adapter | TypeScript 构造 + invariant assertions | 开发与测试阶段 |

任何来自 Extension 的 getter、handler 或 hook 都可能抛错。Shape 校验不能提前访问与当前能力无关的属性；读取第三方对象时只取白名单字段，并把异常包装为有 source 信息的诊断。Tool 的 `renderShell/renderCall/renderResult` 不参与 Schema 或执行合同，normalizer 直接剥离并记录 excluded 诊断。

## 稳定错误模型

建议至少定义以下错误码：

| 错误码 | 含义 |
| --- | --- |
| `PI_COMPAT_UNSUPPORTED_IMPORT` | specifier 或 subpath 未在 profile 中 |
| `PI_COMPAT_UNSUPPORTED_EXPORT` | facade 未提供所请求 export |
| `PI_COMPAT_EXCLUDED_TUI_IMPORT` | Extension 在运行时导入了明确排除的 `pi-tui` |
| `PI_COMPAT_EXCLUDED_PRESENTATION` | 已剥离 Tool renderer、展示注册或 Theme |
| `PI_COMPAT_EXCLUDED_TUI_API` | Extension 注册快捷键或调用了非结构化交互的 UI/TUI 方法 |
| `PI_COMPAT_INVALID_REGISTRATION` | registration 必填字段或函数形状错误 |
| `PI_COMPAT_INVALID_SCHEMA` | Schema 非 JSON-safe、无法编译或超出限制 |
| `PI_COMPAT_SCHEMA_DIALECT` | dialect/关键字不受支持 |
| `PI_COMPAT_ARGUMENT_PREPARE` | `prepareArguments` 执行失败 |
| `PI_COMPAT_ARGUMENT_VALIDATION` | Tool 参数不符合 canonical Schema |
| `PI_COMPAT_INVALID_EVENT_RESULT` | handler 返回了无效变换结果 |
| `PI_COMPAT_STALE_GENERATION` | 旧 generation facade 被继续调用 |
| `PI_COMPAT_HOST_CAPABILITY` | 当前宿主缺少必需能力 |

错误对象包含 `extensionId`、source path、generation、capability、operation 和可选 cause；日志可以带技术细节，面向用户/模型的错误需脱敏。

## 不采用的做法

- 不把 TypeBox 1 `TSchema` 强制 cast 成 `@sinclair/typebox@0.34` 的 `TSchema`。
- 不在 canonical IR 中保留带 prototype 的 Schema 对象。
- 不同时维护 TypeBox Schema 与 Zod Schema 两份 Tool 参数事实源。
- 不用 `any` 或“校验失败就原样执行”实现兼容。
- 不允许远程 `$ref` 在加载阶段隐式访问网络。

以上策略把生态兼容依赖锁在 ACL 内，未来无论 Vetta native Schema 栈是否迁移，都不会要求 Pi Extension 同步迁移。
