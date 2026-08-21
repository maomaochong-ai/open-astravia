# 参与 Open Vetta

<p align="center"><a href="CONTRIBUTING.md">English</a> · <b>简体中文</b></p>

感谢你考虑贡献。本仓库是开源客户端：桌面应用、CLI、文档站、插件 SDK、主题和 Agent 内核。商业服务端不在这里。

最有杠杆的贡献通常是一个目录——插件、Skill、主题、市场条目或文档页——而不是框架重写。本文说明每类改动该放哪里，以及 PR 要过的门槛。

提问、半成型想法、「这个项目还维护吗」请走 [GitHub Discussions](https://github.com/openvetta/open-vetta/discussions)，不要开 Issue。

---

## 一个下午，一个 PR

| 如果你想… | 实际在交 | 放哪里 | 体量 |
|---|---|---|---|
| 给桌面加一个插件 | 插件包 | [`packages/plugins/`](packages/plugins/) · 手册 [`docs/plugin/`](docs/plugin/) · 公开指南 [docs.openvetta.com/plugins](https://docs.openvetta.com/plugins/getting-started/) | 一个包 + `plugin.json` |
| 沉淀一种可复用的工作方式 | Skill | [`packages/skill-presets/`](packages/skill-presets/) 或 GitHub 市场源，见 [`docs/open-marketplace.md`](docs/open-marketplace.md) | 一个带 `SKILL.md` 的目录 |
| 换一套外观 | 主题 | [`packages/themes/`](packages/themes/) · [`docs/theme/`](docs/theme/) · [主题指南](https://docs.openvetta.com/themes/getting-started/) | 一个主题包 |
| 发布可安装能力 | 市场条目 | [`openvetta/vetta-official-marketplace`](https://github.com/openvetta/vetta-official-marketplace)，格式见 [开放市场文档](docs/open-marketplace.md) | 一个目录 + 清单行 |
| 改进产品或开发者文档 | 文档页 | [`apps/docs-site/content/docs/`](apps/docs-site/content/docs/) | 一篇 MDX |
| 翻译界面文案 | i18n 词条 | 桌面端语言包；用户可见文案不得硬编码 | 一个 PR |
| 修 bug 或加产品功能 | 代码 | 已经拥有该行为的 `apps/` 或 `packages/` | 正常 PR |

拿不准自己属于哪一行，先开 [Discussion](https://github.com/openvetta/open-vetta/discussions/new?category=ideas)。

---

## 本地环境

最短路径见 [`QUICKSTART.zh-CN.md`](QUICKSTART.zh-CN.md)。摘要：

```bash
git clone https://github.com/openvetta/open-vetta.git
cd open-vetta
git checkout dev
bun install                 # 需要 Bun 1.3+
cd apps/desktop
bun run dev                 # Vite renderer + Electron，数据在 ~/.vetta-dev
```

**不要**在仓库根目录跑 `bun run dev` 或 `bun run build`——那是编译核心库，不会启动应用。**不要**直接跑 `bun test`；用 `bun run test:pkg <name>` 或 `bun scripts/quality/run-vitest.mjs --run <file>`。

---

## Pull Request

PR 请发到 **`dev`**，不要发到 `main`。`dev` 是集成分支，`main` 是较慢的快照。

- **一个 PR 只做一件事。** Skill + 重构 + 升依赖是三个 PR。
- **填完整 PR 模板。** Why / Validation 留空会退回。
- **能关联 Issue 就关联**（`Fixes #N`）。非平凡功能应先有 Discussion 或 Issue。
- **用户可见文案必须走 i18n**，包括 label、placeholder、菜单和 aria。
- **快捷键**必须进入现有 keybinding 对象，不得在业务逻辑里写死。
- **Commit message 使用中文**，关联工单写 `fixes #N` / `closes #N`。
- Review 期间推 fixup，不要对共享分支 force-push，除非评审明确要求。

不要求 CLA。贡献按本仓库的 [Apache-2.0](LICENSE) 授权。

### 验证门槛

| 改动类型 | 开 PR 前的最低要求 |
|---|---|
| 文档、文案、模板、注释 | 核对你改过的链接、命令和路径 |
| Bug 修复或行为变化 | 一条在旧代码上会失败的测试，外加 `bun run check:quick` 和对应的 `bun run test:pkg <name>` |
| 公共合同（IPC、Schema、导出、持久化） | 检查生产者与消费者，并补合同测试 |
| UI 交互 | 在受影响层补组件/交互测试；`verify:ui:*` 不是默认 PR 要求，仅在 Issue 或评审明确要求时使用 |

不要声称跑过未执行的检查。`bun run check` 是 lint + 类型 + 架构守卫，不能替代测试。

面向 Agent 和内部工程的规则（包边界、coding-agent 分层、Desktop i18n、质量门禁）在 [`AGENTS.md`](AGENTS.md) 和 [`docs/dev/quality-gates.md`](docs/dev/quality-gates.md)。改代码时遵守那些文件；本文件是对外贡献地图。

---

## 我们不接受的 PR

请不要提交：

- **默认开启的新遥测或分析目的地。** 遥测只在构建期 opt-in，见[网络行为](README.zh-CN.md#网络行为)。
- **密钥、Token、Cookie、用户会话或生产配置**，日志和测试夹具同样不行。
- **反向依赖**——`packages/*` 不得 import `apps/*`。走目标包 `package.json#exports` 的公开入口。
- **未先讨论就重写技术栈**（换包管理器、换渲染框架、换 Agent Loop）。
- **静默扩大插件权限或宿主能力。** 插件是不可信边界，按最小集合声明。
- **手改生成文件。** 改生成器或事实源。

拿不准就先开 Discussion，再写代码。

---

## 安全

漏洞请通过 [GitHub Security Advisories](https://github.com/openvetta/open-vetta/security/advisories/new) 私下报告，不要开公开 Issue。详见 [`SECURITY.md`](SECURITY.md)。

---

## 许可

提交即表示你同意贡献按本仓库的 [Apache-2.0 License](LICENSE) 授权。
