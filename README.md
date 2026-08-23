<div align="center">
  <img src="docs/assets/banner.png" width="160" alt="Astravia" />
  <p><strong>Astravia（星轨）</strong> — 本地优先的开源 AI 桌面助手：编码、文档、数据、自动化，一个应用全包。</p>
  <p>无云端、无账号、无遥测，数据与密钥始终留在你的本机。</p>
  <p><b>简体中文</b> · <a href="README.en-US.md">English</a></p>
</div>

---

## 这是什么

Astravia 是一款在 [open-vetta](https://github.com/openvetta/open-vetta) 基础上改造的开源 AI 桌面代理：Agent 内核（编码、文档、自动化、创意）加上桌面产品形态，围绕一个原则——**你在本机工作，数据就留在本机**。

- 没有云端：无登录、无账号、无订阅。模型密钥（BYOK）由你配置，请求直连服务商，密钥只存本机钥匙串。
- 没有遥测：不收集崩溃报告与使用统计；任何出站请求都由你的配置明确触发（见[网络行为](#网络行为)）。
- 数据在本机：会话、工作区、知识库、数据库连接默认都在 `~/.astravia`，不离开你的机器。

## 快速上手

1. 从 [Releases](../../releases) 下载安装包（macOS / Windows / Linux）。
2. 设置中选择模型服务商，填入你自己的 Key。
3. 新建项目开始对话：写代码、整理文档、处理文件。
4. 要查数据时添加数据库连接（SQLite 选个文件，PostgreSQL / MySQL 填连接信息），在「数据库」标签页写 SQL，或直接让 AI 查。
5. 重复性工作交给批量任务与定时任务，完成时通过飞书 / 钉钉机器人收到通知。

## 桌面应用能力

所有能力都是应用的一部分，彼此并列——不需要额外安装客户端，也不依赖外部服务。

| 能力 | 说明 |
| --- | --- |
| **对话与工作区** | 消息流、工具调用过程、生成结果同屏可见；会话按项目组织在侧边栏；活动面板实时展示工具调用与进度。文件在应用内直接预览（PDF、Word、PPT、表格、图片、音视频、SVG），扫描版 PDF 可离线 OCR。 |
| **数据库** | 内置连接管理与 SQL 工作台：表浏览、多标签查询、历史记录、CSV/JSON 导出与数据编辑。AI 可在对话中直接查数——表结构按需注入（开关默认关），描述需求即得表格结果。写操作分级授权，`prod` 连接默认只读，行数与超时上限可配。引擎基于 dbx（Apache-2.0）自建二进制随应用分发，支持 40 余种数据库（SQLite、PostgreSQL、MySQL、SQL Server、Oracle、MongoDB、Redis、ClickHouse、DuckDB、Snowflake、BigQuery 等）。 |
| **批量任务** | 一个 Prompt 对多个目录批量执行；任务按「项目 + 任务」组织，可运行、可重试，进度实时可见。 |
| **定时调度** | 内置 Cron 调度，任务在托盘后台执行，执行历史可查。 |
| **通知与远程控制** | 批量 / 定时任务完成或异常推送飞书、钉钉机器人（凭据本地加密）；手机 IM 可遥控本机 Agent，目前接入飞书（Telegram、钉钉规划中），由内嵌 `im-gateway` 边车实现，随应用启停。 |
| **扩展生态** | 能力市场从任意 GitHub 仓库安装 Skill、MCP Server、插件与能力包（搜索在本地快照完成）；Skill 把做事方法固化成技能；MCP 接入后工具对 Agent 自动可见；插件按需启用；主题整体替换；本地文档加工成可检索知识库供 Agent 引用，全程不出本机。 |
| **UI 设计工作区** | 无限画布上的设计稿是真实可运行的界面；整份设计共享一套色彩系统，画框可导出渲染图或只读分享包。 |
| **桌面集成** | 全局快捷键唤起快捷面板；macOS Appshot 一个手势把前台窗口（截图、标题、屏上文字）交给 Agent；环境设置配置 Node / Python 运行时；托盘常驻、自动更新、中英双语界面。 |

## 插件系统

插件不是边角功能——设计画布、内容创作、Git、图表、文件预览这些工作区形态本身就是插件写出来的，同一套扩展点对第三方完全开放。插件既能扩展界面（活动面板、文件预览、消息卡片、快捷键…），也能扩展 Agent 本身（注入系统提示词、技能、工具与 MCP Server、接管新会话引导）。每项能力必须在 `plugin.json` 显式声明权限，由宿主单独授权、运行时再校验；预装与第三方插件走同一套 API。

```tsx
import { definePlugin } from "@astravia-org/plugin-sdk";

export default definePlugin({
	activate(ctx) {
		ctx.ui.registerActivityTab({ id: "my-tab", label: "我的面板", component: MyPanel });
	},
});
```

内置插件：

| 插件 | 说明 |
| --- | --- |
| [astravia-ui-design](packages/plugins/presets/astravia-ui-design) | UI 设计画布 |
| [content-creation](packages/plugins/presets/content-creation) | 内容创作 |
| [plugin-workbench](packages/plugins/presets/plugin-workbench) | 用对话构建插件 |
| [git](packages/plugins/presets/git) | Git 变更 |
| [image-gen](packages/plugins/presets/image-gen) | 图像生成 |
| [chart-renderer](packages/plugins/presets/chart-renderer) | 数据图表化 |
| [office-viewer](packages/plugins/presets/office-viewer) | 文档预览 |
| [media-viewer](packages/plugins/presets/media-viewer) | 媒体预览 |
| [svg-viewer](packages/plugins/presets/svg-viewer) | SVG 预览 |
| [astravia-actions](packages/plugins/presets/astravia-actions) | 官方动作集 |

`packages/plugins/externals` 下另有几个示例插件不随应用打包。

## 安装

从 [Releases](../../releases) 下载安装包，由 `.github/workflows/desktop-release.yml` 构建发布。从源码构建需要 **Bun 1.3+** 与 **Node 20+**：

```bash
bun install
bun run build
bun run build:desktop     # 桌面应用
bun run build:cli         # 可选：CLI 封装
```

IM 旁路网关（Go，可选）：`cd packages/im-gateway && make build`。

## 架构

Monorepo 分四层，依赖单向向下：**应用 → runtime-\* → coding-agent / agent / ai**。核心库不感知宿主，同一套内核既能跑在 Electron 桌面端，也能跑在终端 CLI。

```
astravia/
├── packages/
│   ├── ai · agent · coding-agent · ecosystem-adapter   # 多 Provider LLM、Agent 循环、编码智能体、生态适配
│   ├── runtime-core · runtime-tools · runtime-storage  # 宿主应用共享的适配层
│   │   └── runtime-mcp · runtime-telemetry             # MCP 管理器绑定；遥测仅落盘
│   ├── desktop-app · cli-app · im-gateway              # Electron 宿主、CLI、IM 旁路（Go）
│   ├── ui · theme-ui · theme-sdk                       # UI 原语与主题体系
│   ├── plugins · skill-presets · themes                # 扩展生态预设
│   └── capability-sdk · capability-runtime             # 能力与权限层
├── docs/                                               # 架构文档与 ADR
└── scripts/                                            # 构建、发布、质量守卫
```

## 模型配置

内置多家服务商预设，预设只含 `baseUrl` 与 API 类型，**不含任何 Key**：

| 项目 | 说明 |
| --- | --- |
| 服务商预设 | Claude、OpenAI、DeepSeek、Z.ai、Kimi、Gemini、Grok、Qwen |
| 模型同步 | 填入自己的 Key 后立即拉取该账号可用模型，之后每 12 小时后台同步 |
| 元数据 | 价格与能力元数据由 [models.dev](https://models.dev) 补齐，随包带快照兜底 |
| 请求路径 | 直发服务商，应用不代理、不转发、不计费 |
| 自定义端点 | 支持 OpenAI 兼容端点（Ollama / vLLM / LM Studio 等本地推理） |

## 网络行为

只在以下情况发起网络请求，且全部由你的配置决定：

| 场景 | 触发条件 |
| --- | --- |
| LLM 推理 | 你配置的服务商；不配 Key 即不发生 |
| 模型元数据 | `models.dev` 公共目录；失败回退随包快照 |
| 能力市场 | 你添加的 GitHub 仓库；不加来源即不发生 |
| 自动更新 | 更新源由应用配置决定（基于 electron-updater）；不配即不检查 |
| MCP / 插件 / Webhook / IM | 由你安装的扩展与填写的凭据决定；不装即不发生 |

没有遥测，没有崩溃上报，没有使用统计。

## 参与开发

```bash
bun run check              # Biome + 类型检查 + 架构守卫（开 PR 前必跑）
bun run check:quick        # 改动文件的快速反馈
bun run test:unit          # 核心库单元测试
bun run test:pkg ai        # 单包测试；test:pkg --list 查看全部
bun run test:changed       # 只跑受改动影响的包
```

约定：包管理统一用 Bun；TypeScript 禁止无必要 `any`；用户可见文案必须走 i18n；提交信息用中文并关联工单（`fixes #N` / `closes #N`）。完整规范见 [AGENTS.md](AGENTS.md)。版本采用全包一致的 lockstep 策略，每个包独立维护 `packages/*/CHANGELOG.md`。

## 致谢

本项目由 [open-vetta](https://github.com/openvetta/open-vetta) 改造而来，并离不开以下开源项目：

| 项目 | 用途 | 许可 |
| --- | --- | --- |
| open-vetta | 上游项目：Agent 内核、桌面宿主与插件体系均在此基础上改造 | Apache-2.0 |
| pi · Mario Zechner | `ai` / `agent` / `coding-agent` / `ecosystem-adapter` 在其基础上重写与迭代 | MIT |
| Codex CLI · OpenAI | 执行沙箱方案借鉴其设计；Windows 直接使用其沙箱宿主二进制 | Apache-2.0 |
| bubblewrap | Linux 平台沙箱后端 | LGPL-2.0+ |
| PP-OCRv5 · PaddlePaddle | 离线 PDF OCR 的检测与识别模型 | Apache-2.0 |
| dbx | 数据库引擎（dbx-mcp），fork 自建二进制 | Apache-2.0 |
| python-build-standalone · Astral / Node.js | 便携运行时发行源 | 见原仓库 / MIT |
| Cowart | `plugins/externals/cowart-astravia` 由其改编，不随应用打包 | 见原仓库 |

另外还要感谢 [Model Context Protocol](https://modelcontextprotocol.io) 规范与 [models.dev](https://models.dev) 公共模型目录。第三方组件的完整清单与原版权声明见 [NOTICE](NOTICE)。

## 许可

[Apache-2.0](LICENSE)。
