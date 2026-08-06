---
name: plugin-workbench
description: >
  Create, implement, build, pack, install, reload, and manage Vetta desktop plugins
  for non-developers. Use whenever the user wants a Vetta plugin, plugin scaffolding,
  apply zip to Vetta, edit plugin.json name/guidingWords, or debug plugin load/install.
  Requires the Plugin Workbench input-bar toggle (hard isolation). Full plugin handbook
  is bundled under the workbench root agent/docs/plugin/ (same content as docs/plugin).
---

# 制作插件（完整流水线）

面向**不懂开发的用户**：你读规范、写代码、跑标准脚本、装进本机；用户只回答问题与点确认。

**质量底线**：没有读过内嵌插件手册就动手写实现 = 禁止。凭记忆编造 SDK API 很容易装上不能用。

---

## 0. 解析工作台根目录（先做）

```
workbenchRoot = listPlugins() 中 id === "plugin-workbench" 的 rootPath
```

若拿不到：用宿主 `plugins.query` list，或面板/会话上下文；失败则 AskUserQuestion 请用户确认 App 已启用系统插件「制作插件」。

| 资源 | 绝对路径 |
| --- | --- |
| **插件开发手册（≈ docs/plugin）** | `{workbenchRoot}/agent/docs/plugin/` |
| 文档索引（本 skill 附件） | 本 skill 目录 `references/doc-index.md` |
| 实现模板摘要 | 本 skill 目录 `references/templates.md` |
| 标准脚本 | `{workbenchRoot}/scripts/*.mjs` |

生产 App **不包含** monorepo 的 `docs/plugin`。**只认**上面 `agent/docs/plugin/` 路径。

---

## 1. 强制读文档（不可跳过）

用 **read 工具**打开文件（绝对路径），不要只 skim 本 skill。

### 1.1 每次创建或大改插件

1. `read {workbenchRoot}/agent/docs/plugin/README.md` — 能力矩阵与导航  
2. `read {workbenchRoot}/agent/docs/plugin/getting-started.md` — 工程结构、MF、构建安装  
3. `read {workbenchRoot}/agent/docs/plugin/manifest.md` — plugin.json  
4. `read {workbenchRoot}/agent/docs/plugin/permissions.md` — 权限清单  

### 1.2 按用户目标追加（实现前）

| 用户意图 | 必读 |
| --- | --- |
| 侧栏面板 / 活动 Tab | `ui-slots.md`（activity-tab） |
| 输入栏按钮 | `ui-slots.md`（input-action） |
| 文件预览 | `ui-slots.md`（file-preview + **notify 错误上报**）+ `styling-and-pitfalls.md`（**面板布局边界**） |
| 全局弹层 | `ui-slots.md`（global） |
| 任何可能失败的 IO/解析 | `ui-slots.md`（**notify**）+ `styling-and-pitfalls.md`（错误必须上报） |
| Agent 工具 / 读写文件 / 对话 | `conversation-and-agent.md` |
| 消息下方卡片 | `message-cards.md` |
| 插件自带 MCP | `mcp.md` |
| 样式 / 布局逃逸 / 不生效 / 缓存 | `styling-and-pitfalls.md`（含**面板类 slot 禁止 viewport fixed**） |
| 引导词 / 设置项 | `manifest.md` 对应章节 |

### 1.3 实现时

- API 名、权限、scope_use fail-closed、返回值形状 **以手册为准**。  
- 模板摘要见 `references/templates.md`，但细节冲突时以 `agent/docs/plugin/*` 为准。  
- 不确定就再 read 对应章节，或 AskUserQuestion。

---

## 2. 前置条件

1. 用户已打开输入栏 **「制作插件」** toggle（硬隔离；关着则 skill/agent 贡献不可见）。  
2. 工程在**当前会话 cwd**（或一层子目录），无特殊工场目录。  
3. 用户插件依赖：`@vetta-org/plugin-sdk` / `@vetta-org/plugin-vite` 用 **registry 已发布 semver**（scaffold 默认 sdk `^0.1.1` / vite `^0.0.5`，两者版本独立；若 install 失败问用户 registry/版本）。  
4. 构建用 **托管 Node + npm**；标准脚本封装，禁止随意手搓另一套 pack（除非用户明确要求且你已读 getting-started 的打包约定）。

---

## 3. 禁止臆测（必须 AskUserQuestion 或等价确认）

| 项 | 原因 |
| --- | --- |
| 插件 `id` | 全局唯一，装后难改 |
| 展示名 `name` | 用户可见品牌 |
| `permissions` 列表 | 安全；对照 permissions.md 向用户解释再写入 |
| 要解决的问题 / MVP 范围 | 避免一次做全家桶 |
| 是否立即安装到本机 | 构建后是否引导用户在面板点「应用到 Vetta」 |
| 扩展点类型（用户没说时） | activity-tab / 工具 / 引导词 / 预览 / … |
| **工作模式定位（通用 / Work 专属 / Coding 专属）** | 决定 `plugin.json` 的 `agent_mode`；白名单外整个插件不可见。**新建插件必问** |

---

## 4. 端到端流水线

### 4.1 澄清

AskUserQuestion 收齐 §3；对照 README 能力矩阵选定扩展点 → 列出要读的文档章节 → **先 read 再写代码**。

### 4.2 Scaffold

```bash
node "{workbenchRoot}/scripts/scaffold.mjs" "{cwd}/{plugin-id}" --id {id} --name "{name}"
```

然后按文档改：

- `plugin.json`：permissions、guidingWords、agent、styles、moduleFederation、**`agent_mode`**（工作模式定位：通用=不写；Work 专属=`["work"]`；Coding 专属=`["coding"]`，见 manifest.md）…  
- `src/index.tsx`：register* / registerTool 等（遵守 styling 顶层 JSX 规则）  
- 需要 skill/prompt 时按 manifest 建目录  

可选：

```bash
node "{workbenchRoot}/scripts/check-manifest.mjs" "{pluginRoot}"
```

### 4.3 实现质量检查（自检清单）

对照已读文档确认：

- [ ] 每个用到的 API 都在 `permissions` 里声明  
- [ ] 会话页 UI / 工具都写了合理的 `scope_use`（fail-closed）  
- [ ] 工具 description 写清何时调用  
- [ ] 无 MF 顶层 JSX 陷阱  
- [ ] **样式：只用 Tailwind className；未手写业务 .css / 未用全局选择器**（`style.css` 仅 theme+utilities 入口，见 styling-and-pitfalls）  
- [ ] **面板布局：file-preview / activity-tab 内无 `fixed` 贴视口、无超高 z-index、无 portal 到 `document.body`**；面板内浮层用 `relative`+`absolute`；全局浮层用 `registerGlobalSlot`，Toast 用 `notify`（见 styling-and-pitfalls → 面板类 slot 布局边界）  
- [ ] 用户工程无 `workspace:*`  
- [ ] i18n：若要宿主渲染中文 label，按手册用 catalog / `%key%`（desktop 用户文案规范）  
- [ ] **错误可排查：所有可能失败的路径（读文件/解析/网络/外部库）在 catch 里调用 `ctx.ui.notify({ message, error })`**，禁止只写死「失败」文案、丢掉原始 error；`notify` 无需权限，有 `error` 时宿主 Toast 可一键复制堆栈（见 `ui-slots.md` → notify）  


### 4.3.5 热更新感知（改已装插件前必查）

改一个**已安装**的插件前，先 `plugins.query` → `get {id}` 看返回项有没有 `devWatch` 字段：

- **`devWatch` 存在（热更新已开启）**：改完工程源码或 `plugin.json` 即结束——vite watch 构建成功后自动重载；dev 会话内新增 permissions/commands 也会自动放行。**禁止**再走 4.4/4.5 或 reload。若 `devWatch.status === "error"`，提示用户看面板错误或拨一下热更新开关。仅当用户明确要**持久**写入注册表（关热更新/重启后仍生效）时，才用 `workbench_offer_reinstall` 让用户点卡片「重新安装」。
- **`devWatch` 不存在**：走 4.4→4.5 常规流程（构建打包后引导用户在面板点「应用到 Vetta」）。

### 4.4 构建打包（强制脚本）

```bash
node "{workbenchRoot}/scripts/build-and-pack.mjs" "{pluginRoot}"
```

- 默认：patch bump → `npm install` → `npm run build` → `release/{id}-{version}.zip`  
- 解析 stdout JSON：`zipPath`、`id`、`version`  
- 失败：读 stderr，按 getting-started / styling 修；缺依赖或 registry 问题 → AskUserQuestion  

### 4.5 安装到本机 Vetta（引导用户在面板点击，不要弹确认）

打包完成后**不要调用** `plugins.manage` 的 `install-from-path`（会弹确认 sheet，工作台流程已废弃此路径）。改为告知用户：

> 打开右侧活动面板「制作插件」→ 对应工程卡片 → 点 **「应用到 Vetta」**（面板安装一次完成授权 + 启用，无确认弹窗）。

- 应用成功后面板会**默认开启「热更新」**：之后你改源码即自动构建+重载（§4.3.5），无需再次应用。用户可手动关掉。  
- 再次应用（热更新被关掉时）：build-and-pack 后再请用户点「应用到 Vetta」（应用后会重新默认开启热更新）。  
- 不可覆盖系统插件 id。

### 4.6 改 name / guidingWords

只改 **工程源码** `plugin.json`，再 4.4 → 4.5。禁止改 `~/.vetta/plugins/...` 已装目录当真相源。

### 4.7 卸载 / 重载 / 重新安装

- `plugins.manage`：`uninstall` / `reload`（系统插件不可卸）。
- **重新安装**（权限/命令等安装态变更）：工具 `workbench_offer_reinstall` 出消息卡，或面板「重新安装」——**不要** `install-from-path`。

---

## 5. 运维面板

Activity Tab「制作插件」（同样受 toggle 硬隔离）：扫描 cwd、构建、应用、卸载、重载、改 name/引导词。与对话同一规则与同一脚本。

每张工程卡片有 **「热更新」开关（已安装后默认开）**：宿主把插件 dev 链接到工程目录并常驻 `vite build --watch`，保存源码即自动构建 + 自动重载（无需 bump/重打 zip/手动 reload）。适合迭代调试。

已安装时还有 **「重新安装」**（与消息卡按钮同路径）：强制 build-and-pack → 把权限/命令**持久写入注册表** → **刷新整个 Vetta 窗口**。日常改代码 / 改 plugin.json 靠热更新即可（dev 会话内权限声明自动放行）；重新安装用于落盘授权或热更新异常时兜底。首次安装仍用「应用到 Vetta」。

---

## 6. 排错

| 现象 | 处理 |
| --- | --- |
| Skill/工具不可见 | 是否打开工作台 toggle；系统插件是否启用 |
| npm install 失败 | registry、网络、sdk 版本；AskUserQuestion |
| 构建失败 | 读完整错误；对照 getting-started / 依赖版本 |
| 装上无效果 | permissions 是否授予；scope_use；插件 enabled；reload + version |
| 反复改 UI 调试 | 已安装工程默认开热更新：保存即自动构建+重载（见 §5）；若被关掉可再打开 |
| UI 不出现 | ui-slots 权限与 scope_use；activity tab 是否 attach |
| 样式/缓存怪 | styling-and-pitfalls；bump version |
| 运行时「失败」但不知原因 | 插件是否 `notify({ message, error })`？让用户右下角 Toast 点「复制堆栈」贴给你；没有则补 notify 后热更新再复现 |
| 只显示红字无堆栈 | 实现遗漏：catch 必须把原始 `error` 传给 `ctx.ui.notify`（见 §4.3 与 ui-slots notify） |

---

## 7. 边界

- 不发布插件市场、不拖拽式 no-code 搭建  
- 不保证任意原生/C++ 依赖在托管 Node 下可构建  
- 细粒度权限仍可在设置页调整  
- 用户自建插件默认 **不要** 开 hardIsolation（除非用户明确要求模式开关）

---

## 8. 附件

- `references/doc-index.md` — 手册路径与阅读表  
- `references/templates.md` — 常见扩展点代码起点  

**再次强调**：实现前 `read` `{workbenchRoot}/agent/docs/plugin/` 下对应文件；该目录即 Vetta 插件开发手册（与仓库 `docs/plugin` 同源同步）。
