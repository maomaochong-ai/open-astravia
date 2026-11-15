# ADR-0176：补齐上游既有的「自定义图片服务」

## 状态

已接受，已实施。

## 背景

设置 → Agent 配置 → 图片里，参照实现早就有「自定义图片服务」：用户自己填一个兼容 OpenAI
的图片服务（名称、Base URL、模型、API Key、支持文生图 / 图生图），保存后它作为一个普通
图片 provider 出现在上方的路由下拉里。本仓这条分支从未移植过它——`grep customImageProviders`
零命中，主进程、preload 合同、渲染模型与界面全缺。

**它不属于 ADR-0157 的 0.5.72→0.5.81 窗口。** 证据是上游引入它的提交
`078f081f6 feat(desktop): 支持自定义 OpenAI 兼容生图服务` 早于 `v0.5.72`，
而 `git log v0.5.72..v0.5.81 -- apps/desktop/src/main/media-generation/` 为空。
窗口内只碰到它的两处外圈（文案精简与皮肤统一）。因此它是「补齐上游既有能力」，
单独立项，不塞进 0.5.72–0.5.81 的对齐登记表。

## 决策

### 1. 只说一种协议，把它当作普通 provider 注册

用户配的服务一律按「OpenAI 兼容」建模，只有两个端点：

| 模式 | 请求 |
| --- | --- |
| 文生图 | `POST {baseUrl}/images/generations`，JSON：`model` / `prompt` / `n: 1` / `size` |
| 图生图 | `POST {baseUrl}/images/edits`，multipart：同上 + `image` 文件 |

Base URL 由用户填写并包含版本段（`https://api.example.com/v1`）。服务注册进现有的
`MediaProviderRegistry`，descriptor 的 id 是 `custom-openai:<uuid>`——**带命名空间**，
避免与内置 provider（`desktop-app:astravia`）或插件 provider 撞 id。

不新增 fetcher、不新增 registry、不新增 job 概念：`submit` 返回的仍是普通 `MediaProviderJob`，
失败按既有 `MediaFailure` 分类（`unauthenticated` / `content-rejected` / `invalid-request` /
`provider-timeout` / `provider-failed`）。

### 2. 密钥只进凭据库，永不回传

| 数据 | 落点 |
| --- | --- |
| 名称 / Base URL / 模型 / 能力开关 | `~/.astravia/desktop-app/custom-image-providers.json`（`schemaVersion: 1`） |
| API Key | `CredentialVault`，命名空间 `image-providers`，`ownerId` 是服务 id |

这条是硬约束，四处都要成立：

1. 上面那份 JSON 里**不出现** key；
2. `list()` 只回 `hasApiKey: boolean`，不回值；
3. 发请求时才从 vault 取，写进 `Authorization` 头，**不进描述符、不进日志、不进错误信息**；
4. 上游错误正文若回显了 key，先抹成 `***` 再截断（300 字符）——这段文字会进工具结果与日志。

编辑时留空表示沿用已存 key；但**换了主机就必须重新填**：`origin` 变了还沿用旧 key，
等于把凭据悄悄发给另一个服务。

### 3. 生命周期跟着媒体运行时走

`CustomImageProviderManager` 由 `registerDesktopMediaProviders` 构造，与 registry、artifact
store 同寿命：

- 构造时读配置并为每条已存服务注册 provider（重启后仍然可用）；
- `save` 更新配置后重新注册（先 dispose 旧的，避免 `already registered`）；
- `remove` 同时 dispose provider、删记录、清 vault 里那条 key；
- 运行时 `dispose()` 回收全部注册，不留热重载残留。

### 4. 界面：列表 + 内联表单，与上游同一形态

设置页那一块在原有两条路由下拉下面追加一段：

- 标题行：`自定义图片服务` + 一句说明 + 右侧「添加服务」；
- 列表行：`名称 · 模型` 与 Base URL，行尾「编辑 / 删除」两个文字按钮；
- 表单在卡片内就地展开（不是弹窗），字段顺序与上游一致：
  名称、Base URL、API Key（`type=password`，已存过则提示「留空沿用」）、模型、
  两个复选框（文生图 / 图生图），底部「取消 / 保存」。

上游把这套表单做成内联而不是弹窗，理由是它需要在填写时对照上面的路由下拉；本仓沿用。
校验在渲染层先做一遍（必填、`http(s)` 前缀、至少一种能力、新增必须填 key），
主进程再做一遍——渲染层的校验只为省一次往返，不构成信任边界。

### 5. 没有 provider 时：下拉不禁用，但不再挂「去能力页安装」

本仓是开源构建，默认没有任何内置图片 provider。上游的做法是「只有一个选项就禁用下拉」，
禁用会让入口看起来坏了，所以本仓保持可展开——点开看到唯一的「自动选择」，就说明了真实状态；
缺失原因仍由行下方的 `noProviders` 说明承担。

**曾经多挂过一条「去能力页安装图像服务」的引导链接，本轮删除。** 理由有两条：

1. 设置项只负责这一项设置本身。缺什么、去哪儿补属于能力页的叙述，把它塞进设置行会让
   一行里出现两个不同层级的动作（选值 / 跳转别处），而且这个链接在两行里各出现一次。
2. 有了自定义图片服务之后「没有可用服务」不再等于「得去装一个」：用户完全可以自己添一个
   兼容 OpenAI 的服务，链接反而把这条更直接的出路盖住了。

因此 `installProvider` 文案、`openMarketplace` 动作与 `navigate("/abilities")` 一并删除，
`ImageRouteSelect` 退回一个纯 `MotionSelect`（同时去掉写死的 `min-w-[220px]`，宽度交给内容自适应，
与 ADR-0161 §2 的宽度策略一致）。

## 备选方案

- **只做文案与皮肤（路线 A），不移植功能**：改动 2 个文件、零风险，但用户在开源构建里
  仍然没有任何可用的图片服务，这一块设置页永远是「当前没有可用的图片生成服务」。
- **用一个通用的「OpenAI 兼容网关」覆盖所有媒体类型**：省掉一个 manager，但图片与视频的
  请求形态差异很大（`n`/`size` vs 异步任务轮询），抽象会立刻漏。
- **让用户手写 `providers.json`**：无需界面，但这正是「设置里能配」要解决的问题；
  而且 key 会落进明文配置。

## 后果

- 正面：开源构建里图片生成/编辑从「只能看不能配」变成「填一个兼容服务就能用」；
  密钥路径与既有 `CredentialVault` 同源，不引入第二套加解密。
- 代价：新增约 600 行主进程 + 合同 + 界面代码，以及一份新的持久化文件
  `custom-image-providers.json`；该文件只含非机密字段，可安全备份。
- 兼容性：`DesktopMediaApi` 新增 `customImageProviders.{list,save,remove}` 三个方法，
  属**新增**合同，旧的渲染层不认识它们也不会坏。
- 安全边界：自定义服务是一个**外部网络端点**，用户填什么就请求什么。没有做「只允许
  https」的强制（本地回环服务常用 `http://127.0.0.1:<port>`），但禁止 URL 内嵌凭据、
  禁止 query / fragment；下载 `url` 结果时只在同源条件下带 `Authorization`，
  避免把 key 发给图片 CDN。
- 已知限制：`supportsTextToImage` / `supportsImageToImage` 是用户自报的，本仓不做能力探测；
  报错的服务只会表现为该模式下请求失败。

## 验证

`apps/desktop/src/main/media-generation/custom-image-provider-manager.test.ts`（11 例）：

| 风险 | 断言 |
| --- | --- |
| 注册进 provider 列表且带每模式模型 | `listProviders()` 的 id / displayName / modes / defaultModelId / models |
| 只开放用户勾选的能力 | 只勾文生图时 `modes === ["text-to-image"]` |
| **密钥不外泄** | 配置文件、vault 目录、`list()`、`listProviders()` 四处都不含明文 key |
| 重启后仍可用 | 新建 registry + manager，提交任务仍带 `Authorization` |
| 请求形态 | 文生图打到 `/images/generations`（JSON 体逐字段相符）；图生图打到 `/images/edits`（multipart） |
| 下载结果不带凭据 | 跨域图片 URL 的 `Authorization` 为空 |
| 上游回显 key | 失败任务的 `JSON.stringify(job)` 不含 key，只含 `***` |
| 编辑沿用 key / 换主机要求重填 | 改名保留 key；换 origin 抛 `API key is required` |
| 删除清干净 | provider、记录、vault 三处都空 |
| 非法配置被拒 | `ftp://`、内嵌凭据、两种能力都没勾、空 key、空模型 |

未运行：界面层没有单独用例（表单校验是渲染层的便利，真正生效的是主进程校验）；
真实第三方图片服务未接入测试——需要一个付费端点，本轮未获授权。
