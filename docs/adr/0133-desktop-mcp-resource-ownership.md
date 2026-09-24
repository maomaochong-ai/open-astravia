# ADR-0133：Desktop MCP 连接按应用与工作区分层持有

## 状态

已接受。

## 背景

Desktop 曾把内置、全局和项目 MCP 全部装进以 `cwd + agentDir` 为键的工作区 Source。普通对话子目录会归并到默认目录，因此能命中启动预热；团队会话使用按会话创建的目录，每次首发都会重新启动相同的全局 MCP。真实日志中，这一步稳定占用约 9–12 秒，并在 Runtime 创建模型请求前同步阻塞。

不能简单把所有 MCP 按应用共享。项目 `.vetta/mcp.json`、`${PROJECT_ROOT}` 展开和 `roots/list` 都以当前工作区为语义边界，共用连接会把一个项目的根暴露给另一个项目。插件 MCP 还受会话能力选择控制，必须保持会话级生命周期。

## 决策

1. Desktop 主进程持有应用级 MCP Source，并在 Runtime Host 启动后异步预热。内置 MCP 和全局 `agent/mcp.json` 中不依赖项目根的 server 进入该 Source，跨普通与团队会话复用，直到 Runtime Host 退出。
2. 项目 `.vetta/mcp.json` 中的 server 始终属于工作区。全局 server 引用 `${PROJECT_ROOT}`，或声明 `resourceScope: "workspace"` 时也属于工作区。工作区 Source 继续按规范化 cwd 与 agentDir 隔离，并沿用现有空闲释放行为。
3. 全局 server 可声明 `resourceScope: "application"` 明确应用所有权。项目配置中的同字段不能提升其作用域，以免项目文件扩大宿主能力边界。
4. 应用级连接不声明 MCP roots capability。需要 `roots/list` 的 server 必须进入工作区层。工作区仍按本地/SSH 规则返回真实可访问的根。
5. 会话组合并行刷新应用与工作区 Source，按工具名合并，工作区 binding 覆盖应用 binding。插件 MCP 继续由 Coding Agent 的会话层覆盖基础视图，既有能力选择规则不变。
6. 登录状态变化会形成新的应用 Source generation；已存在会话继续使用旧 generation，新会话使用与当前凭据状态匹配的 generation，所有 generation 在应用退出时释放。令牌轮换仍通过请求时的动态 header 读取处理。

## 备选方案

- 所有 MCP 共用一个连接：会混合项目配置、`${PROJECT_ROOT}` 和 roots，未采用。
- 只把团队目录映射到普通对话目录：缓存会命中，但团队工具会拿到错误的工作区根，未采用。
- 首轮模型请求不等待 MCP：会改变首轮工具集合和模型行为，未采用。
- 每次选择团队后再预热该团队目录：用户立即发送仍会等待，而且按会话生成的新目录无法提前穷举，未采用。

## 兼容与验证

旧配置无需迁移。全局配置默认进入应用层；依赖 roots 但没有引用 `${PROJECT_ROOT}` 的全局 server 需要显式增加 `resourceScope: "workspace"`。项目配置、插件 MCP 和远程项目无行为变化。

验证覆盖配置分层、项目覆盖、工具名冲突、跨工作区复用、工作区释放、应用退出释放与重试、认证 generation 切换，以及应用级连接不暴露 roots。10 秒 MCP 初始化注入夹具把该等待放到预热阶段后，四成员团队从会话创建到模型请求开始的中位数为 917.4 ms，首个文本增量为 931.7 ms。
