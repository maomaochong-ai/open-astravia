# Toolkit Development Rules

本文件适用于 `packages/toolkit/` 及其全部子目录。

## 迁移工具

新增或修改以下内容前，必须先阅读 [`docs/migrations.md`](docs/migrations.md)：

- 使用 `@vetta/toolkit/versioned-config` 迁移 JSON schema。
- 使用 `@vetta/toolkit/file-migrations` 调整目录或文件布局。
- 为消费方设计 migration 目录、版本文件、校验和回写流程。
- 修改 Toolkit 迁移 API、类型或示例。

强制约定：

- 业务 schema 和迁移必须留在消费包，不能放入 Toolkit。
- JSON schema 迁移采用连续的 `vN -> vN+1` 文件，不允许跨版本跳跃。
- 迁移注册入口只负责声明迁移链，不放具体转换逻辑。
- 迁移函数只转换普通数据；文件读写、运行态装配和 UI 逻辑必须放在迁移链之外。
- 先迁移到当前版本，再使用 TypeBox、Zod 或消费包现有方案校验最终结构。
- 新增版本时必须补迁移测试，并验证旧版本、当前版本和未来版本拒绝行为。

## 模块边界

- `versioned-config` 是纯函数模块，可以用于插件和浏览器构建。
- `config-store`、`atomic-write` 和 `file-migrations` 依赖 Node.js，不得引入浏览器或 renderer 运行时。
- Toolkit 只提供通用机制，不依赖 Desktop、Electron 或具体业务包。
