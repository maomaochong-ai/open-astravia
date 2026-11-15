# ADR-0172：采纳参照实现的品牌身份（本机代理、应用图标、引导面板）

## 状态

已接受。应用图标一组（`izqa`、`e7nz` 默认部分 + 外观页图标选择器）**已实施**；
本机代理与引导面板两组仍待实施。对应 ADR-0157 登记表里 13 条品牌条目（§14）。

产品方在本轮明确：**这 11 条采纳，按参照实现对齐**。此前它们被单列的理由是「采纳即
采用对方的品牌与产品身份」——这个判断本身没有错，只是结论变了：本项目既然定位是参照
实现的二次开发，品牌身份也一并继承，不再逐条等确认。

## 背景

ADR-0157 最初把三类条目从「功能对齐」里摘出来：本机代理（Magpie，4 条）、像素白鼬
应用图标与 Dock 图标（4 条）、Splash 引导面板（3 条）。它们的共同点是改动不产生新的
功能语义，改的是「这个产品看上去是谁」：一个预置的服务商入口、一套可选的应用图标、
一个引导面板的外壳与层级。

三者对代码的侵入方式完全不同，因此不合成一个批次：

| 类别 | 本质 | 侵入面 |
| --- | --- | --- |
| 本机代理 | 一个预置服务商条目 + 可编辑地址 + 启用开关 | `main/models/presets`、模型设置页、供应商图标注册表 |
| 应用图标 | 一套图标资源 + 一个外观设置入口 + 主进程换图标 | `apps/desktop/build`、外观设置、主进程 `app.dock`/`BrowserWindow` 图标 |
| 引导面板 | Splash 外壳的统一与层级调整 | `theme-ui` 的 Splash 组件、⌘K 面板外壳 |

## 决策

### 1. 本机代理：作为普通预置服务商接入，不享受特权路径

参照实现的 `magpie` 预置是 `openai-completions` + `baseUrl: http://127.0.0.1:3425/v1`
+ `defaultApiKey`。落到本仓要补的是**三个通用能力**，而不是给它开一条专用分支：

1. `PresetProviderDef` 增加可选 `defaultApiKey`：有值的预置在创建时预填密钥，用户不再
   需要自己填一个假 key。这不是「免密」，只是「默认值」。

   **这类预置在行内不给「修改密钥」入口，也不给删除入口**（本轮修正，与参照实现的
   `autoKey` 一致）。理由是同一条事实的两面：既然密钥由产品内置、用户无从得知也无从修改，
   给一颗钥匙按钮只会让人以为「必须先有一个 key 才能用」；而它不在用户可添加的目录里，
   删掉之后也装不回来。行内保留的是开关与端口编辑——那是用户真正能决定的两件事。

   字段与推导链与参照实现逐层一致，不新造名字：

   | 层 | 名字 | 含义 |
   | --- | --- | --- |
   | 预设定义 | `PresetProviderDef.defaultApiKey?: string` | 产品内置的密钥值（Magpie 是 `"magpie"`） |
   | 主进程快照 → preload 合同 | `PresetProviderInfo.defaultApiKey?: string` | 原样透传，**不**在这两处改叫别的名字 |
   | 渲染层行 | `PresetProviderRow.autoKey: boolean` | 由 `Boolean(row.defaultApiKey)` 派生 |
   | 视图 | `row.autoKey` | `canEditKey = !offline && !autoKey`；端口编辑 `canEditUrl = autoKey && !offline`；删除 `adopted && !autoKey` |

   **启用时的密钥取值（本轮修正）**：`adoptPreset` 的草稿 key 必须写成
   `const key = (draftKeys[row.id] ?? row.defaultApiKey ?? "").trim()`——空草稿时回落 `defaultApiKey`，
   而不是空串。这条规则与 `autoKey` 是同一件事的**两个消费点**：`autoKey` 决定「行内给不给密钥按钮」，
   `defaultApiKey` fallback 决定「启用时 apiKey 落成什么」。此前只接了前者、漏了后者，于是 Magpie 行内
   不再要密钥、但启用后 `apiKey` 落成空串，实际使用时又被要求重新填——正是「不需要密钥」这句产品承诺
   只实现了一半。两处必须同时存在，缺一即为 bug。

   视图的三个判据与参照实现 `PresetProviderRowView` 的写法逐字对应。此前本仓有两个偏差：

   视图的三个判据与参照实现 `PresetProviderRowView` 的写法逐字对应。此前本仓有两个偏差：
   把行模型叫成 `hasDefaultApiKey` 且只用它表达「空草稿也能采纳」，于是 Magpie 那一行同时
   出现钥匙按钮与「空草稿可保存」；另有一个参照实现根本没有的 `localProxy` 字段，用它决定
   端口按钮——两处都已在这次收敛掉（`localProxy` 从预设定义、合同、行模型、视图一并删除）。
2. 预置服务商支持**启用开关**：未启用的预置不出现在模型选择器里（`ojsy` 已在
   B5 落地了「停用的预设服务商不再出现在模型选择里」的读取侧，这里补写入侧）。
3. `baseUrl` 可编辑，且**只对本机回环地址开放端口修改**（`f52cefabc` 的最终态）：
   地址栏拆成固定的 `http://127.0.0.1:` 与端口输入，避免用户被要求填一个完整 URL。

模型列表与普通预置共用同一个拉取与「测试连通」路径，不新增 fetcher。

### 2. 应用图标：资源进构建目录，运行期只认一个设置键

- 资源放 `apps/desktop/build/app-icons/`（打包用，含 macOS 的 `-mac` 变体与标准边距）
  与 `apps/desktop/src/renderer/domains/settings/assets/app-icons/`（设置页预览用）。
- 设置页只暴露一个入口：当前图标 + 点击开 popover 选十款之一，图标外框用超椭圆
  （`rounded-[22%]` 一类），并给图标留内边距——参照实现踩过的坑是图标撑满成大头贴。
- 选择结果是一个持久化设置键，由主进程应用：Dock/窗口图标在 macOS 上换 `app.dock.setIcon`，
  Windows/Linux 换 `BrowserWindow` 的 `icon`。**不做**「改完立即重启应用」。
- Dock 默认图标用带 824 本体的版本，并自带超椭圆遮罩与标准边距；这是打包资源问题，
  在 `build/icon-dock.png` 与 electron-builder 配置里解决，不在运行期裁切。

### 3. 引导面板：只做外壳统一，不重做交互

- ⌘K 面板与「添加项目」「管理会话」共用同一个 `SplashPanel`（`warf`，B4 已落地），
  本轮把 ⌘K 面板迁过去，消掉最后一份自绘外壳。
- 面板去掉外阴影、去头部分隔线、底栏保留分隔线并换底色、标题头部加大加粗
  （`hl6i` / `8afc059a4` / `709750d8b`）。这些只在 `theme-ui` 的 Splash 组件里改一次。

### 4. 品牌边界（本轮收紧）：出厂图标是 Astravia 自己的

品牌采纳原来写成「整套图标资源与身份一并继承」。实际执行时要把两类素材分开：

| 类别 | 内容 | 归属 |
| --- | --- | --- |
| 出厂身份 | `default` 应用图标、Dock 默认图标、安装包图标 | **本仓自己的 Astravia 图标**，不继承参照实现 |
| 场景图标 | `coding` / `design` / `work` / `study` / `read` / `game` / `sport` / `cook` / `travel` / `sleep` 十款 | 沿用参照实现的素材 |
| 规范 | 超椭圆遮罩、824 本体、标准边距 | 沿用参照实现的做法（形状与边距，不是图案） |

理由：出厂图标是用户第一眼看到的应用身份。把它设成对方的形象，会让「这是哪个产品」在
Dock、任务栏、安装包、设置页四个位置同时出现第二种答案。场景图标是风格素材，与身份无关，
继续沿用不会造成这种歧义。

落地方式：`settings/assets/app-icons/default.png` 由本仓 `build/icon.png`（1024 画布、
824 本体）裁到图形本体后缩放到 256 生成；`appIcon_default` 文案由「默认 / Default」改为
「Astravia」；打包侧仍走 `icon.icns` 与 `icon-dock.png`，与场景图标不是同一条路径。

## 备选方案

- **只采纳应用图标，不采纳本机代理**：图标是纯装饰，代理会引入一个用户不一定装的
  本地服务。但产品方要的是「和参照实现一致」，半采纳会让设置页出现「有这个服务商但
  参照实现里长这样」的持续解释成本。
- **把本机代理做成隐藏的内置服务商**：省掉设置页工作，但用户无法改端口、也无法关掉，
  一旦本机没装那个服务就永远有一条连不上的条目。
- **应用图标在运行期裁切成超椭圆**：能保证任意图源都圆角一致，但每次切换都要解码与
  重绘大图，且打包图标（Dock、安装包）走的不是同一条路径，两边会不一致。

## 后果

- 正面：设置页、预置服务商、引导面板三处的外观与参照实现一致，不再出现「功能一样但
  看着是两个产品」。
- 代价：仓库里会出现一批像素风图标资源（约 20 个 PNG + 一份 Dock 图标），二进制体积
  增加；这些资源来自参照实现，需在 `NOTICE` 里按许可记录来源。
- 兼容性：`PresetProviderDef.defaultApiKey` 与「预置启用开关」都是新增可选字段，
  旧的 `models.json` 不需要迁移；未启用的预置只在选择器层面隐藏，已存在的会话仍可读。
- 已知限制：Dock 图标的超椭圆遮罩只在 macOS 生效；Windows/Linux 用同一份 824 本体
  的方形资源，不做平台特调。
- 品牌边界（见决策 4）：出厂图标归本仓，参照实现只提供场景图标与「超椭圆 + 824 本体」
  的规范；`NOTICE` 只需记录场景图标素材来源。

## 验证

- 预置服务商：`main/models/presets` 的目录用例（默认 key、回环端口解析、停用后不进选择器）、
  模型设置页的组件用例（启用开关写回、端口输入拒绝非数字与非回环地址）。
- 应用图标：设置页组件用例（十款可选、当前项高亮、写回同一设置键）；主进程用例
  （设置键变化时 `setIcon` 被调用一次，不触发重启）。
- 引导面板：`theme-ui` 的 Splash 组件用例（无外阴影、底栏分隔线、标题层级）；⌘K 面板
  迁移后原有命令面板用例全绿。
- 打包：`bun run build:presets` 与 electron-builder 资源清单包含新图标；macOS 上人工
  核对 Dock 图标边距（仅在用户明确要求时跑 `verify:ui:*`）。

## 实施记录（应用图标）

按上游最终形态落地，资源直接用官方图标集（20 张打包图 + 11 张设置页预览图）：

| 层 | 落地位置 | 说明 |
| --- | --- | --- |
| 共享 id | `apps/desktop/src/shared/app-icon.ts` | 11 个 id 的单一事实源，未知值回落默认 |
| 持久化 | `desktop-config.appIconId` | 与界面缩放同级；缺省即出厂图标 |
| 主进程 | `main/app-icon/app-icon-service.ts` | macOS 换 `app.dock.setIcon`（`-mac` 变体），Windows/Linux 换窗口图标；启动时套用一次 |
| 通道 | `main/ipc/app-icon.ts`、`preload/apis/app-icon.ts` | `astravia:app-icon:get/set/changed` |
| 渲染 | `renderer/shared/hooks/useAppIcon.ts`、`AppearanceSettingsView` | 单个入口 + popover，超椭圆裁切 |
| 打包 | `scripts/build-resource-filters.mjs` | `app-icons/**/*` 随 `build/` 进 resources |

外观页同时按参照实现收敛：语言行与界面大小行不再带说明文字，应用图标作为同一张卡片的
第四行紧跟界面大小之后。字体行随后并入同一张卡片作为最后一行（`border={false}` 收尾），
不再自带分区标题、副标题或说明——细节见 ADR-0161 §9。

**本轮修订（0.5.94）**：

| 项 | 改动 |
| --- | --- |
| 出厂图标 | `settings/assets/app-icons/default.png` 改为由本仓 `build/icon.png` 的 824 本体生成；`appIcon_default` 文案改为「Astravia」；打包侧的 `icon.icns` / `icon-dock.png` 不变 |
| 图标形状 | `SquircleIcon` 的 `clip-path` 从极坐标扰动换成 n=5 超椭圆参数方程，11 个图标同形 |
| 打包守卫 | `build-resource-filters.node-test.mjs` 三条断言锁住三平台 filters 都含 `app-icons/**/*`（缺了它打包后切换图标静默失效） |
| 预置服务商行 | 启用开关改为常驻（未采纳时是「关」，拨开即启用）；「换密钥」与「改端口」从行内输入改为 `Dialog`；`shouldCloseEmptyApiKeyEditor` 与其 10 条用例随行内编辑一起删除 |

## 实施顺序

1. 预置服务商三件套（`defaultApiKey` → 启用开关 → 端口编辑），与供应商图标一起；
2. 应用图标资源与设置入口；
3. Splash 外壳收口（⌘K 面板迁移）。
