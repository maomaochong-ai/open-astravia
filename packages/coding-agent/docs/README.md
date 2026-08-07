# coding-agent 文档

产品组合层 `@vetta/coding-agent` 的用户与集成说明。架构与重写记录见仓库 `docs/agent/coding-agent/`。

| 文档 | 读者 |
|------|------|
| [sdk.md](sdk.md) | 进程内嵌入 Session |
| [rpc.md](rpc.md) | 子进程 stdin/stdout 协议（Desktop / IM） |
| [extensions.md](extensions.md) | 编写 Extension |
| [MCP.md](MCP.md) | MCP 配置 |
| [skills.md](skills.md) | Skill 发现与结构 |
| [prompt-templates.md](prompt-templates.md) | 提示词模板 |
| [settings.md](settings.md) | `settings.json` |
| [models.md](models.md) | 模型、凭证、`models.json` |
| [packages.md](packages.md) | 扩展包安装 |
| [tool.md](tool.md) | 内置工具归属（贡献者） |

类型与协议以源码为准：`src/public-api/`、`src/modes/rpc/rpc-types.ts`、`src/extensions/api-contracts.ts`、`src/settings/schema/`。

示例：`examples/sdk/`、`examples/extensions/`。
