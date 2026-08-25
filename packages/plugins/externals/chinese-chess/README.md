# 中国象棋对弈（Chinese Chess game）

与 Agent 对弈中国象棋的 Vetta 外置插件：安装后侧边栏出现「象棋」入口，随时执红或执黑开局，不限时；棋局与对话记录保存在插件私有存储中，除非手动重置，跨重启保留。

## 设计要点

- **规则引擎**：走法生成、合法性校验（含送将过滤）、将军/将死判定与 PEN 序列化全部来自开源库 [zh-chess](https://github.com/kongyijilafumi/zh-chess)（MIT），本插件只做薄封装（`src/game/engine.ts`），不自造规则。
- **对弈 loop 完全在插件内部**：通过宿主通用能力 `ctx.ai.chat()`（无状态多轮 + 插件内部工具）驱动。模型每轮收到文字棋盘与全部合法着法，必须调用插件私有的 `make_move` 工具落子；非法走法会被拒绝并要求重走，多次失败后由本地兜底逻辑代走，保证对局不会卡死。**不向宿主 Agent 注册任何工具或 skill**，不影响正常会话。
- **持久化**：`ctx.storage` 保存 PEN 局面、着法历史、AI 消息转写与模型偏好（`game/state.json`）。恢复时按历史重放校验一致性；重启打断的 Agent 回合会自动续走。
- **图标**：`assets/logo.svg` 同时作为插件 Logo 与侧边栏「象棋」入口图标（未声明 workspace view `icon` 时宿主回落到 `plugin.json` 的图标，并按主题前景色 mask 渲染）。
- **模型选择**：`ctx.ai.listModels()` 提供模型切换（未选时用宿主默认模型），选择随棋局持久化。

## 开发

```bash
# 仓库根目录安装依赖
bun install

cd packages/plugins/externals/chinese-chess
bun run check   # tsc
bun run test    # vitest（引擎/记谱/对弈 loop/存储 + jsdom 组件测试）
bun run build   # dist/ + release/chinese-chess-<version>.zip（安装制品）
```

坐标约定见 `src/game/notation.ts`：列 `a-i` 对应 x 0-8，行数字对应 y 0-9（红方底线 y=9）；中文纵线记法与 zh-chess 的 `moveStr` 语义一致，并由测试锁定。
