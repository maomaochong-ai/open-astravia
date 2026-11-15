# ADR-0164：更新对话框与运行时性能对齐 0.5.73–0.5.77

## 状态

已接受并实施。本记录覆盖 ADR-0157 登记表中 `updater`（12 条）、`runtime-node`（4 条）、
`ai`（1 条）、`agent`（1 条）、`desktop` 的 `0pkz`、`release` 的 `9a1n`。
`layout`/`window`/`activity` 里的红绿灯与活动面板条目归 ADR-0163，不在本记录。

## 背景

这一批分成两个不相干的半块，共用「没有新公共合同」这一点：

- **更新对话框**是一个用户必须读完才能决策的界面——要不要现在重启。参照实现在 0.5.75
  把它重做成「横幅 + 版本介绍 + 可滚动正文 + 常驻渐隐 + 通栏按钮」，并追加了侧栏
  「先看更新内容再重启」的入口。本仓此前是一个窄对话框、正文是纯文本、底部按钮会被
  过长的正文顶出可视区。
- **运行时性能**是另一回事：会话文件写一条事件就要整份重读重解析、模型输入图片每轮都
  重复缩放、prompt cache 指纹把同一段上下文反复拼成字符串哈希三次。三者都在主进程上，
  表现都是「打字跟着断续卡顿」。

## 决策

### 1. 更新对话框：同一视图承载「版本介绍」与「更新」两种内容

`useUpdateRestartDialogModel` 同时打开 `updaterCurrentNotesDialogOpenAtom`（看当前版本说明）
与 `updaterRestartDialogOpenAtom`（更新流程），视图按 `phase` 决定头部与底栏按钮。这样
「版本介绍」不是第二套对话框，侧栏图标点开与更新就绪弹窗用的是同一份排版。

正文里的四件事各自有原因：

- **横幅随内容滚动，顶部加渐隐**：横幅固定在顶部时，小窗口下会把正文挤到只剩两行；
  滚动后渐隐消失，用户才知道上面还有东西。
- **底部渐隐常驻、有按钮时更明显**：正文与按钮之间没有分隔线，滚动中两者会糊在一起；
  渐隐是「下面还有内容」的唯一提示。
- **`no-scrollbar`**：全局 overlay 滚动条规则没有 layer，Tailwind 的隐藏写法压不过它，
  所以用仓库自己的 `no-scrollbar` 标记类。
- **正文去掉开头的版本标题与状态注释**：`stripReleaseNoteHeader` 同时被主进程（更新源给的
  说明）与渲染进程（随包说明）使用——对话框自己有标题与版本号，正文里再来一次就是重复。

设置页「通用 → 应用 → 当前版本」那一行同样按参照实现对齐：左侧是标题与状态文案，
右侧是「查看版本介绍」+「检查更新」两颗同皮肤的 `variant="field"` 按钮。

这一行前后修过两次，两次都不是「没做」，而是**接了一半**：

1. 第一次：视图里的按钮是 `ghost` / `outline`（与参照实现的 `variant="field"` 不同），已改。
2. 第二次（本轮）：`UpdateCheckerAction` 的规则是「`labels.viewCurrent` 与 `onViewCurrent`
   同时给才渲染按钮」，而宿主适配层只转发了 `checking / labels / onCheck / phase`——
   文案在、回调缺席，按钮静默消失，用户看到的就是「这一版没有版本介绍」。

第 2 次值得单记一条规则：**当视图用「可选 prop 决定是否渲染」来表达差量时，适配层必须把
那个可选 prop 一起转发**，否则最糟的结果不是报错，而是功能安静地不见——类型检查也看不出来
（prop 本来就是可选的）。现在的回归用例从宿主适配层进入（`GeneralSettingsView.updater.test.tsx`），
只断言「两颗按钮都在、点前者会打开当前版本的说明」，摘掉转发就会红。

「版本介绍」打开的仍是同一个对话框（`useUpdateRestartDialogModel` 的 `notesOpen` 分支，
正文来自 `readCurrentReleaseNote`：打包后读 `resources/release-notes/v<version>.md`，
开发态读仓库 `.github/release-notes/v<version>.md`，两者都没有时显示「暂无这个版本的介绍」）。

**卡片里的每条变更只显摘要，不再「标题 + 细节」两行（本轮修订）。** 本仓发布说明每条是
`- **粗体标题**：细节正文` 的形态，`outlineReleaseNote` 把它拆成 `{ title, body }`。
早先预览里两条都渲染，一个版本几十条变更，每条占两行、细节动辄一两百字，卡片里铺出来的
就是整篇发布说明的搬运。现在有 `title` 的条目只显 `title`（摘要），完整细节由卡片下方的
「查看更多」打开全文 Markdown 预览；只有 `body`（无粗体标题的旧格式或第三方 feed）才把
`body` 当摘要显示——它没有更短的形态。

GitHub 更新源给的是 Markdown，`ReleaseNoteMarkdown` 负责排版；此前被当成纯文本渲染，
星号与井号原样显示。跨多个版本时保留各段的小标题（那是区分版本的唯一线索），单版本时去掉。

### 2. 侧栏更新入口从「横幅条目」改为图标

底栏原来是一整行「有新版本 · 立即重启」，占掉一个条目位置。改为仅在
`available`/`downloading`/`ready` 出现的实心圆箭头 + 淡光环；下载中换转圈并禁止重复点击；
就绪时点开更新对话框。`SidebarUpdateBanner` 及其模型一并删除，不保留两套入口。

下载期间设置页「检查更新」按钮禁用并显示进度，判定放在视图层
（`busy = checking || downloading`），因为「正在下载时不该再点检查」是呈现规则，不是状态机规则。

### 3. 会话文件解析按文件身份缓存，重放路径只有一条

补的两件事中，**重放共用**其实是先决条件：投影是记录上的纯折叠，只要「整份解析」与
「增量追加」走同一个重放函数，增量结果就必然与重新读盘一致。本仓已有
`applyConversationRecords(initial, records)` 承担这件事，`documentFromFile` 只是
`initialConversationDocument` + 它，因此这条不需要新代码，只需在追加路径上也用它。

**解析缓存**按 `(ino, size, mtime)` 判定：inode 变了说明文件被整体替换（重写 / 迁移），
长度回退说明被截断，两者都回退到全量解析；长度只增且 mtime 未变时只解析新增的完整行。
缓存按字节上限淘汰（`MAX_CACHED_CONVERSATION_BYTES`），避免几十份大会话一直占内存。

### 4. 图片处理：按原图记忆结果，限内图片只看文件头

- **记忆**：键是「原图 base64 + mimeType + 缩放参数」。每轮模型调用都会重新规范化整段
  历史里的图片，不记忆时超限图片每一步都要在主进程里同步重缩放。同一消息对象复用同一
  个 base64 字符串，键比较几乎无成本。上限 64 条，失败的结果不留在缓存里。
- **限内放行**：文件头（PNG IHDR / JPEG SOF / WebP VP8X 等）已给出宽高、且字节数在限额
  内时直接返回，不做 Photon 全量解码——完整解码只为拿两个数字，却要同步占住主进程。
  读不出文件头（少见格式）时仍走解码，行为不变。

### 5. prompt cache 指纹：一遍流式哈希得到三个前缀

历史前缀、整段请求、以及「上次请求长度」这三个哈希，本质是同一数组的不同前缀。原来把
消息各拼一遍字符串、再各哈希一遍；现在每条消息只序列化一次，一遍流过数组时按目标下标
取三个中间状态即可。上次请求比本次长（用户删了消息）时不参与比较，退化为「无 prev 前缀」。

## 备选方案

- **版本介绍做成独立对话框**：会与更新弹窗出现两套排版与两套按钮布局，而它们内容同源、
  读者目的也接近（「这版改了什么」），合并后只维护一处。
- **解析缓存按 mtime 单独判定**：同一秒内的两次写入在粗粒度文件系统上 mtime 不变，只按
  mtime 会读到旧投影；加上 size 与 ino 才能同时挡住「原地重写」「换文件」「截断」。
- **图片记忆不设上限**：长会话里历史图片会持续累积，一张 4 MB 原图缓存在主进程里，几十轮
  之后就是几百 MB；64 条覆盖一轮的重复面已经足够。
- **prompt cache 指纹改成只算整段请求**：`historyPrefixHash` 是「缓存前缀命中没命中」的
  判据，只有整段哈希无法区分「历史没变、新增一条」与「历史变了」。
- **mac 发布校验加断网重试（`9a1n`）**：本仓发布流水线没有上游那段 CloudKit 校验步骤
  （`.github/workflows/desktop-release.yml` 只做签名与公证，校验交给打包工具），
  没有可重试的对象。记为不适用，而不是照抄一个用不上的重试。

## 后果

- 正面：更新对话框在长正文下也能滚到底并按到按钮；侧栏更新入口不再占一整行；
  写事件不再整份重读会话文件，追加只解析新增行；同一张图一轮里只缩放一次；
  限内图片不再解码；prompt cache 诊断的开销从三次全量序列化降为一次。
- 代价：`parsedFiles` 缓存与凭据/图片记忆一样成为需要关注的内存持有者，各有字节或条数
  上限，超限淘汰；`stripReleaseNoteHeader` 成为主进程与渲染进程共用的清洗规则，
  改它要同时看两边的展示。
- 已知限制：
  - 缓存判定依赖文件系统给出可靠的 `ino`；某些网络文件系统上 ino 可能不稳定，此时退化为
    全量解析（正确但慢），不会读到错误投影。
  - 图片记忆的键是整段 base64，命中时需要一次字符串哈希；超大图（>10 MB）的哈希成本高于
    一次缓存查找的收益，但仍在同数量级，未做分片。
  - 更新对话框的观感（横幅高度、渐隐强度）只在开发壳里按窗口尺寸目测，未有截图基线。

## 验证

- `packages/runtime-node/test/coding-suite/read/model-input-image-processor.test.ts`：
  命中复用、参数不同不命中、失败不缓存、超上限淘汰。
- `packages/runtime-node` 会话仓库用例：同文件二次解析不重读、追加只解析新行、
  inode 变化与长度回退时回退全量、重放结果与整份投影一致。
- `apps/desktop/src/main/dev-cli-shim.test.ts`：签名无效时重新签名、拒绝签名时给出原因。
- `apps/desktop` 更新相关用例：正文过长时底部按钮可达、下载中按钮禁用、
  单版本正文去掉重复标题、多版本保留分段标题。
- prompt cache：指纹与重构前逐字节一致（同一输入得到同一组哈希）。

## 附：逐条状态

| 条目 | 状态 | 依据 |
| --- | --- | --- |
| updater `6o79` 先弹更新内容对话框 | 已对齐 | `updaterCurrentNotesDialogOpenAtom` + `main/current-release-note.ts` |
| updater `bi3o` GitHub 日志还原 Markdown | 已对齐 | `applyConversationRecords` 之外：`ReleaseNoteMarkdown` + `normalizeReleaseNotes` |
| updater `nnpm` 就绪提示文案精简 | 已对齐（B1） | 中英 `common.json` |
| updater `gxxe`/`27j7`/`92q8`/`a0vh`/`41sq`/`bq0p`/`u22a`/`n9tx` 对话框细节 | 已对齐 | `packages/theme-ui/src/overlays/UpdateRestartDialogView.tsx` |
| updater `4qcr` 下载期间禁用并显示进度 | 已对齐 | `UpdateCheckerView` 的 `busy = checking \|\| downloading` |
| runtime-node `gecy` 抽出重放供两条路径共用 | 已对齐 | `conversation-file-codec.ts` 的 `applyConversationRecords` |
| runtime-node `lb0e` 解析按文件身份缓存 | 已对齐 | `file-conversation-repository.ts` 的 `parsedFiles` + `(ino,size,mtime)` 判定 |
| runtime-node `45rs` 图片结果按原图记忆 | 已对齐 | `model-input-image-processor.ts` |
| runtime-node `t241` 限内图片按文件头放行 | 已对齐 | `image-resize.ts` 的 `readHeaderDimensions` + `fitsWithinLimits` |
| ai `ei07` 指纹单遍流式 | 已对齐 | `prompt-cache-diagnostics.ts` 的 `fingerprintArrayPrefixes` |
| agent `plwi` CLI 失败信号不被吞掉 | 已对齐 | `system-prompt-policy.ts` 第 63–64 行 + `system-prompt.test.ts` 断言 |
| desktop `0pkz` 开发垫片重签名 | 已对齐 | `dev-cli-shim.ts` 的 `codesign --verify` / `--force --sign -` |
| release `9a1n` mac 发布校验重试 | 不适用 | 本仓发布流水线无该 CloudKit 校验步骤 |
