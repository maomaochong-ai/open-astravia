# 星轨 · Astravia —— 品牌落地蓝图

> 产品定位：内置数据库管理能力的 AI 代理（本地优先 / 隐私可控）
> 品牌名：中文「星轨」（Xinggui）· 英文「Astravia」（星之路）
> 词源：拉丁语 astra（星辰）+ via（路），源自谚语 *Per aspera ad astra*（历经艰辛，抵达星辰）
> 意象：AI 代理带你穿越数据星河，轨道导航、直达星辰

---

## 一、品牌定稿

| 维度 | 内容 |
|---|---|
| 中文名 | 星轨（Xinggui） |
| 英文名 | Astravia |
| 品牌故事 | 数据如繁星，AI 为你规划轨道——星轨带你航行数据星河，抵达星辰 |
| 域名 | getastravia.com 可用 ✅；astravia.com/.io 已被囤积 ❌；.ai/.dev/.app 需在注册商核实 |
| 备案 | 国内运营需 ICP 备案（.com 需实名） |

## 二、改造范围（已摸清的品牌触点）

### 1. 仓库与包名层
- 仓库名：`open-vetta` → `astravia`（GitHub 新仓库 [maomaochong-ai/Astravia](https://github.com/maomaochong-ai/Astravia)；本机目录重命名待执行——被 Vetta Desktop 宿主进程锁定，需退出应用后手动改名）
- 根包：`vetta-monorepo` → `astravia-monorepo`
- 桌面应用包：`@vetta/desktop-app` → `@astravia/desktop-app`
- 全部 `@vetta/*` 包名 → `@astravia/*`（含 import 路径）

### 2. 打包与安装包层（`packages/desktop-app/scripts/prepare-pack.js`）
- `appId: "com.vetta.desktop"` → `com.astravia.desktop`
- `productName: "Vetta"` → `Astravia`
- `executableName: "Vetta"` → `Astravia`
- 协议：`name: "Vetta"`、`schemes: ["vetta"]` → `astravia`
- Windows 产物名：`${productName}-${version}-win-${arch}.${ext}` 自动跟随
- macOS 系统权限描述文案中的 "Vetta 需要访问本地网络…" → "Astravia 需要…"
- 更新产物名：`Vetta-0.6.0.exe` → `Astravia-0.6.0.exe`

### 3. 应用运行层
- 托盘 tooltip：`tray.setToolTip("Vetta")` → `"Astravia"`
- 窗口标题
- 协议处理器 `vetta://` → `astravia://`
- 数据目录：`~/.vetta` → `~/.astravia`（涉及 `getVettaHomePath()` 相关，需评估迁移策略）

### 4. UI 文案层（i18n）
- 快速面板：`向 Vetta 提问…` / `Ask Vetta…` → Astravia
- 会话导出 HTML：品牌名、`vetta-share-nav__brand`、导出文件名 `Vetta 会话.html`
- 设置页：`Vetta Claw`、`Vetta Vivi` 等子品牌名
- 聊天预测提示「Vetta 正在预测…」

### 5. 图标与品牌资产
- `build/icon.png` / `icon.ico` / `icon.icns` → 新图标（星轨意象：星环 + 轨道）
- DMG 背景图 `build/background.png`

### 6. 文档层
- 根 README.md、docs/、各包 README、CHANGELOG 提及的 Vetta 品牌

## 三、分阶段实施计划

| 阶段 | 内容 | 验证 |
|---|---|---|
| P0 品牌定稿 | 名称、域名、商标查重 | ✅ 已定稿（商标待查） |
| P1 包名与仓库 | 根包名、`@vetta/*` → `@astravia/*` | ✅ 完成（全库 0 残留） |
| P2 打包配置 | appId / productName / executableName / 协议 | ✅ 完成（com.astravia.desktop / Astravia / astravia://） |
| P3 应用内品牌 | 托盘、窗口标题、协议、数据目录 | ✅ 完成（tray=Astravia、~/.astravia） |
| P4 UI 文案 | i18n 中所有 Vetta 品牌串 | ✅ 完成（双语 + 子品牌 Astravia Vivi / Astravia Claw） |
| P5 品牌资产 | 图标、DMG 背景、品牌色 | ⏳ 代码层 check 已通过；图标视觉资产待做 |
| P6 文档 | README / docs / CHANGELOG / 本蓝图 | ✅ 完成（仅已发布版本历史引用保留） |

## 四、待办风险

- **数据目录迁移**：`~/.vetta` → `~/.astravia`，老用户数据需要迁移逻辑（首启检测 + 复制/软链）
- **自动更新地址**：updatePublishConfig 需指向新仓库发布地址
- **子品牌命名**：`Vetta Claw`、`Vetta Vivi` 需要同步设计新名
- **商标查重**：国内商标 35/42 类、海外 USPTO 待正式查询

## 五、执行记录（2026-08-13 环境修复）

P5 验证期间发现并解决的环境问题（Windows + E 盘 exFAT）：

- **exFAT 不支持 symlink/junction**：bun 1.3 在 Windows 上依赖 symlink 建立 node_modules 布局，exFAT 上顶层链接全部失败（EISDIR），且 lockfile 写盘报 EINVAL。
- **pnpm 在 exFAT 上安装失败**且会清空 node_modules（不可用）。
- **解决**：bun 会把完整包内容解压到 `node_modules/.bun/<name>@<version>/node_modules/<name>/`，由 `rebrand/build-node-modules.mjs` + `fix-top-versions.mjs` + `copy-workspaces.mjs` + `gen-bins*.mjs` 手工构建标准 node_modules 布局（多版本包按 bun.lock 顶层键选择 hoisted 版本，嵌套依赖按需补齐如 concurrently/chalk@4）。
- **结果**：`bun run check` 全绿（lint 1473 文件 / tsgo 全库 / desktop-app tsc / guards 4 项）。
- **遗留**：`node_modules/.bun` staging 目录（约 1959 条目）保留在盘上（删除代价高且无害）；`.bun_full/.bun_old/@astravia_old` 等隔离目录已清理；临时文件 biome-full.txt 已清理。

## 六、Git 历史清理（2026-08-13）

应要求移除从上游 fork 带来的全部提交历史，建立全新的自有仓库：

- **操作**：删除旧 `.git`（2096 条上游提交、约 71.8 MB）→ `git init -b main` 全新初始化 → 首次提交。
- **origin**：指向 `https://github.com/maomaochong-ai/astravia.git`（用户指定，推送由用户执行）。
- **node_modules**：已被 .gitignore 忽略，不会进入版本库（首次提交仅含源码与配置）。
- **保留**：`rebrand/` 一次性脚本留在仓库中，作为改造记录。

## 七、下一步计划（P0–P6 完成后）

### P7 数据库集成（✅ 完成 —— 2026-08-23 收口）

**路线**：B1 MVP → B2 自有化 → B3 增强。方案 B + 自有化（最小化 Rust，引擎二进制经 MCP 接入，不内嵌 WebView/独立进程）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| B1 MVP | fork 存档 / 引擎接入 / AI 对话查库 | ✅ 完成（2026-08-13） |
| B2 自有化 | 抽象层 / 构建流水线 / 数据库面板 / schema 注入 / 经典界面 MVP+联动 | ✅ 完成（B2.1–B2.10，含 macOS 平台接入） |
| B3 增强 | 引擎小改 / 界面完善 / AI 原生能力 / Web 版评估 | ✅ 完成（2026-08-23）：B3.1 安全策略定制（执行模式默认最严 + 连接白名单 + 危险 SQL 拦截）+ 执行限制（行数上限/超时可配）+ dbx.db 凭据明文风险评估，`bun run check` 全绿；B3.2 数据编辑 + 写操作确认/审计；B3.2-R 结果工具栏 R1 五项（2026-08-22 核实）；B3.3 自然语言转 SQL few-shot + 数据洞察双场景；B3.4 Web 版评估可选 |

**里程碑**：B1.4「AI 对话查库」✅ → B2.6「经典工具界面」✅ → B2.3「构建权自有」✅ → **B3 完成（2026-08-23）即 P7 收口**

任务明细、勾选状态、工作量与验证标准：→ [dbx-main-integration-tasks.md](../deliverables/dbx-mcp/dbx-main-integration-tasks.md)

---

| 事项 | 内容 | 状态 |
|---|---|---|
| P5 收尾 | 图标（星轨意象 icon.png/ico/icns）、DMG 背景、品牌色 | ⏳ 代码层已就绪，视觉资产待产出 |
| 自动更新 | updatePublishConfig 指向新发布源 | 发布前必须 |
| 数据迁移 | 老用户 `~/.vetta` → `~/.astravia` 迁移逻辑 | 首启检测 + 复制 |
| 合规 | 注册 getastravia.com；商标查重（国内 35/42 类 + USPTO） | 发布前置 |
| 发布 | 推送 GitHub → CI 构建 → 发布 Release | 依赖 P7 与合规 |

## 八、商标查重步骤（合规 · 发布前置）

> 说明：自查初步筛查，最终以商标局/USPTO 官方检索为准；重大决策建议委托代理复核

### 待查检索词
| 检索词 | 说明 |
|---|---|
| 星轨（中文） | 品牌中文名，优先查 |
| XINGGUI（拼音） | 防近似注册 |
| ASTRAVIA（英文） | 国内+海外都查 |
| GETASTRAVIA 等变体 | 域名同名保护 |

### 类别定位（尼斯分类）
- 42 类（软件/AI/SaaS）**必选**；35 类（商业/订阅）**建议选**；9/38/41 类按产品形态可选

### 国内查询（中国商标网 wcjs.sbj.cnipa.gov.cn）
1. 商标综合查询按名称逐项检索：星轨（中文）/ XINGGUI（拼音）/ ASTRAVIA（英文）
2. 限定 42、35 类
3. 筛近似：同名同类别→冲突；高近似（星轨科技/ASTRAVIA TECH 等）→有驳回风险；只看在先有效（法律状态）
4. 记录命中数、最接近 1–3 项、类别与状态

### 海外查询（USPTO tmsearch.uspto.gov）
1. Wordmark 检索 Astravia / Xinggui / Get Astravia
2. 限定 35/42 类
3. 按「混淆可能性」（音形义+商业关系）判近似；同名同类在先注册→冲突
4. 记录命中 + Live/Dead

### 可选扩展
- 欧盟 EUIPO（euipo.europa.eu）；马德里国际注册 WIPO（wipo.int）；getastravia.com 已核实可注册，建议同批推进

### 执行记录表
| 日期 | 检索词 | 渠道 | 类别 | 结果 | 结论 |
|---|---|---|---|---|---|
| 待填 | 星轨 | 中国商标网 | 42 |  |  |
| 待填 | XINGGUI | 中国商标网 | 42 |  |  |
| 待填 | ASTRAVIA | 中国商标网 | 42/35 |  |  |
| 待填 | Astravia | USPTO | 35/42 |  |  |
| 待填 | Xinggui | USPTO | 35/42 |  |  |

### 完成定义
- 国内 42/35、USPTO 35/42 全部检索记录；结论（可申请/需改名/需代理评估）写入本蓝图合规待办；如需申请定主体+代理，排入发布前置
