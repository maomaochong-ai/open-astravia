# Schema、类型与运行时校验

## 1. 结论

不在 `packages/ai` 或 `packages/agent` 新增 Zod 依赖。扩大现有 TypeBox 的使用范围，但只放在真实的不可信边界。Zod 继续用于已经采用它、且确实需要预处理/转换的复杂配置入口。

这不是“TypeBox 比 Zod 更好”的通用判断，而是基于本仓库的约束：

- 工具参数本来就必须向模型输出 JSON Schema。
- `packages/agent` 已用 `TSchema` 和 `Static<T>` 建立工具类型。
- `packages/coding-agent` 约定 Provider JSON Schema 和 Tool Schema 使用 TypeBox。
- `packages/capability-sdk` 已用 `Value.Check`/Decode 建立无代码生成校验路径。
- 额外引入 Zod 会让同一工具输入容易出现 Zod schema、JSON Schema 和 TypeScript type 三份定义。

## 2. 使用决策表

| 边界 | 方案 | 原因 |
| --- | --- | --- |
| LLM tool input | TypeBox + `Static<T>` | 同时需要 JSON Schema 和类型推导 |
| Provider JSON response/chunk | TypeBox + `Value.Check`/Decode | 外部未知数据，需运行时校验；保持统一依赖 |
| IPC/RPC/持久化文档 | Capability SDK 既有 TypeBox 约定 | 属于稳定 wire contract |
| 内部 Message/Frame/Event | TypeScript discriminated union | 已在边界验证，不重复 schema |
| 简单环境变量 | 显式解析函数 | schema 库收益低，错误信息可控 |
| 复杂用户配置、迁移、默认值 | Zod，仅在已有配置包 | 需要 preprocess、transform、default 和版本迁移 |
| 业务不变量 | 显式领域代码 | schema 只能验证结构，不能代替状态规则 |

## 3. Provider 入站校验

每个 Provider 的 `response.ts` 和 `stream.ts` 为 wire payload 定义最小可接受 schema：

- 只声明实际读取的字段。
- Provider 允许扩展时保留额外字段，不因新增无关字段失败。
- 必需语义字段缺失时抛 `AI_RESPONSE_VALIDATION_FAILED`。
- schema 负责结构；finish reason、tool id 配对、块顺序等由显式状态机验证。
- 原始 payload 只在脱敏后进入 debug metadata，不能写入用户可见错误或普通日志。

避免把巨大官方 API schema 完整复制进仓库。完整复制会随 Provider 演进频繁失效，却不能提升本项目未读取字段的安全性。

## 4. 校验 API

建议复用一个窄 helper，而不是实现 Vercel 式 FlexibleSchema：

```ts
function decodeUnknown<TSchemaDef extends TSchema>(
  schema: TSchemaDef,
  value: unknown,
  context: ValidationContext,
): StaticDecode<TSchemaDef>;
```

要求：

- 默认使用 TypeBox Value 模块，不依赖 `eval`/动态代码生成，适配 Electron CSP。
- 错误包含 path、边界名称、provider/model/request id，但不泄露凭据。
- 不返回 `any`。
- schema 若包含 transform，则显式调用 Decode；纯结构检查可调用 Check。
- 热路径若将来有数据证明校验成为瓶颈，再在 Node-only Adapter 中引入编译器缓存；不预先优化。

## 5. Tool schema 单一来源

工具定义应从 schema 派生输入类型：

```ts
const inputSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
});

type Input = Static<typeof inputSchema>;
```

禁止：

- 手写一个 `Input` interface，再手写不受约束的 schema。
- 用 `Type.Unsafe<Record<string, unknown>>` 掩盖类型不匹配。
- 在 Agent 层把已校验输入重新转成 `unknown`。
- schema 通过后跳过路径权限、状态转换等领域校验。

## 6. 为什么不照搬 Vercel schema 抽象

Vercel 的 `Schema<T>` 同时支持 JSON Schema、Zod 3/4、Standard Schema、lazy 创建和异步 validate，适用于面向 npm 生态的通用 SDK。代价包括：

- 多套推导条件类型。
- 多种 JSON Schema 转换路径。
- Zod 世代兼容代码。
- schema vendor 能力差异和 `$ref` 策略。
- 更大的测试矩阵。

Vetta 控制所有一方包，不需要让每个内部调用者自由选择 schema vendor。现在引入同类抽象只会把单一规范变成永久兼容层。

## 7. 必测内容

- schema 与 `Static<T>` 的正向和负向类型测试。
- 每个 Provider fixture 的合法/缺字段/错类型/额外字段。
- 错误 path 和脱敏行为。
- Tool input 的 required、additionalProperties、union、嵌套对象和 Unicode。
- CSP 兼容路径不使用动态代码生成。
- schema 验证通过但业务不变量失败时，错误分类仍正确。
