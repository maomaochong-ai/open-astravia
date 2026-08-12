# Vetta UI Design：设计历史是设计包内的一个 git 仓库

每份设计文档自带版本历史：gitdir 落在 `x.vetd/.history/`，工作区就是 `x.vetd/` 本身，由打进插件的 isomorphic-git 驱动，经既有的 `ctx.command.run("node", …)` 通道执行。agent 每完成一个回合，插件通过 `Stop` hook 自动提交一次；用户在画布右侧的历史抽屉里挑一个版本恢复，恢复本身也是一次新提交。

这不推翻任何已接受的 ADR。它把 ADR-0066（`0066-vetd-design-document-as-a-single-bundle-directory.md`，注意该编号有两份文档）的「一个 `x.vetd/` 目录 = 一份设计，移动、复制、删除只操作一个条目」这条不变量扩展到历史：历史随目录走、随 `.vetdz` 走，不需要用户理解任何 git 概念，也不落到目录外的第二个位置。

理由：设计没有版本控制时，用户想撤回一次改动只能让 agent「再改回去」。模型看不到旧版本，只能凭对话记忆重写代码，结果既不精确也不可验证——用户要的是「回到那一版」，拿到的是「一次新的猜测」。这个问题不能靠更好的提示词解决，只能靠真实的历史快照。

## Considered Options

### 历史存在哪

- **A 影子仓库放设计包外**（`<项目根>/.vetta/design-history/<相对路径>.git`，`--git-dir` + `--work-tree`）：设计目录绝对干净，用户仓库看不到任何东西。但它打破了上述自包含性——在 Finder 里拷走 `x.vetd/`、或导出 `.vetdz` 分享，历史都留在原地丢掉了。
- **B 设计包内 `x.vetd/.history/`（选定）**：历史是设计的一部分，拷贝、导入导出天然携带。目录名刻意**不叫** `.git`：叫 `.git` 会让放在代码仓库里的设计变成 embedded repository，用户 `git add` 报警告、clone 下来是个空壳。isomorphic-git 允许 gitdir 与工作区分离，所以名字是自由的。
- **C 设计包内 `x.vetd/.git/`**：对懂 git 的用户最透明，可以直接 `cd` 进去用命令行操作、推到远端。代价就是 B 规避掉的那个嵌套仓库问题，且它是持续性的，不是一次性的。

`.history/` 同时写进 `x.vetd/.gitignore`：用户自己的 git 仓库里，设计改动仍然是可读的源码 diff，不会掺进几千个二进制 object 文件。代价是 clone 用户仓库拿不到设计历史——但 `.vetdz` 拿得到，而 `.vetdz` 才是分享设计的通道。

### git 从哪来

- **A 系统 git + 探测不到就降级**：零成本，但 Windows 设计师大量缺失，且 macOS 未装 Xcode CLT 时执行 `/usr/bin/git` 会弹出系统安装对话框——一个设计工具不该把用户推进开发者安装流程。「有时候有历史、有时候没有」比统一没有更难解释。
- **B 内置真 git 二进制**（给 `runtimes/manifest.json` 加第三个 type，走 ADR-0011 的 vendor → 解压 → registry → PATH 注入）：能力最完整，其他插件也能用。但 node/python 都有现成的可再分发归档，git 没有：Windows 有官方便携包 MinGit，macOS 与 Linux 都得自建可重定位（`RUNTIME_PREFIX`）构建，且 `paths.ts` 已经记录了「macOS 只能以解压目录形态内置，因为归档内的 Mach-O 签不到名、公证要逐个校验」——git 的 `libexec/git-core` 是上百个到主二进制的硬链接，签名与公证在这种形态下会发生什么**没有实测过**，是这条路上第一个要验的问题。三个平台各一套坑，换来的能力我们只用到 `init / add / commit / log / checkout -- <path> / diff --name-status` 六条。

  这条路仍然值得单独评估，但目标不同：真正需要系统 git 的是**模型在 bash 里给用户的代码项目敲 git 命令**（全仓没有任何一行代码直接调用 `git`），那在没装 git 的机器上是断的。设计历史不在其中——它由 C 覆盖，与用户机器上有没有 git 无关。
- **C isomorphic-git 跑在托管 node 上（选定）**：纯 JS 实现随插件 dist 分发，经插件已经用熟的 `ctx.command.run("node", ["-e" | <runner>])` 通道调用（`engine-manager.ts`、`check-syntax.ts`、`open-demo.ts` 都是这条路），而 node 是托管运行时、必然就绪。零平台矩阵、零公证、零安装失败，三端行为一致，不动宿主一行代码。产物是标准 git 仓库，日后想换成真 git 或让用户用命令行打开都不受阻。

### 谁来提交

- **A agent 显式调用 `vetd_commit`**：能写出语义最好的 message，一个回合内还能分多次提交。但模型会忘——`.notes.json` 的处理流程已经证明这类「回合末尾必做」的约定需要 SKILL.md 里反复叮嘱才勉强可靠，而漏一次就是一个版本永久缺失。
- **B `Stop` hook 自动提交（选定）**：插件注册 `Stop` hook（ADR-0064 的 hook 适配层），回合结束、设计目录有变更就提交。agent 完全不需要知道 git 存在，不花 token，也不会漏。粒度天然是「用户一句需求 = 一个版本」，正是用户回退时要找的粒度。

## Consequences

- **提交标题不依赖模型**：标题取 `UserPromptSubmit` 事件里的 prompt 首行，副标题是 git 自己算出的变更文件列表。用户原话是「不对，再改改」时，文件列表仍能让人认出是哪一次。让模型写摘要要么额外一次请求，要么拿 `lastAssistantMessage`——后者常常是「已完成，请查看画布」这类无信息量的话。

- **中断的回合不会被提交，所以需要两个额外的封存点**：`Stop` hook 走 continuation 通道，`stop-hook-continuation-source.ts` 在 `context.signal.aborted` 时直接返回空——用户按「停止」中断的回合不触发提交。因此工作区脏时，在**新 prompt 进来前**和**执行恢复前**各自动封存一个版本。否则「中断 → 直接恢复旧版」会真的丢掉用户还没看的改动。

- **恢复是前向提交，历史只增不减**：恢复把旧版本内容写回工作区，再落一个新提交。误恢复可以再恢复回去，不存在不可逆的误操作。代价是历史列表里会出现「恢复到 X」这类条目，长期使用后列表比实际迭代次数长。

- **粒度是整份设计，不做单帧恢复**：frames 之间通过 `components/`、`theme.css` 强耦合，只把一帧拉回旧版很容易凑出新旧混搭的碎状态——旧帧引用一个已经改过签名的组件，源码读起来完全正常，渲染是白屏。整体恢复总是自洽的。

- **`.notes.json` 不进版本控制**：它是用户与 Vetta 之间此刻的待办对话，不是设计内容。回退设计时把已经回复过的备注变回未处理是错的。`design.json` 相反——画框位置属于「那时候设计长什么样」，跟着一起回退。

- **缩略图存在 git 对象库之外**：提交后把变更帧的画布位图写到 `.history/thumbs/<sha>/`，最多 3 张。放进 git 会让每次提交都新增一批二进制 blob，而缩略图是可丢弃的展示资源，不值得进历史。画布位图尚未刷新完时允许缺图，条目退化成纯文字。

- **`x.vetd/.gitignore` 的写入必须改成幂等补齐**：`snapshots.ts` 的 `ensureSnapshotsIgnored` 当前是「已有 `.gitignore` 就绝不重写」。加入 `.history/` 后，这个策略会让所有已存在的设计永远漏掉这一行，必须改成逐行补齐缺失项。

- **导出 `.vetdz` 必须绕开 `ctx.fs`**：`export-design.ts` 用 `ctx.fs.listFilesRecursive` 收集文件，而宿主实现（`filesystem-service.ts`）跳过所有 `.` 开头的条目、且有 10000 文件上限。`.history/` 因此对导出不可见——要带进 `.vetdz`，必须由 node 侧的 runner 打包回传，导入侧还原。这也是历史目录必须隐藏的原因：几千个 loose object 若出现在列举结果里，会撑爆上限并拖慢画布的文件监听。

- **恢复后要重新判断依赖**：`design-package.ts` 的 `needsDependencyInstall` 判据是「声明了依赖且 `node_modules` 不存在」。恢复到一个装过某个库的版本时 `node_modules` 是存在的但内容不匹配，构建会失败。判据需扩展为「`package.json` 变更后也补装」。

- **恢复后画布要整份重载**：`design.json` 被整份覆盖，不能只走现有的增量文件监听——manifest 需重读，受影响帧的位图需重截。

- **agent 可以恢复，但要能自我纠正**：新增只读的 `vetd_history` 与执行恢复的 `vetd_restore`（插件侧 `ctx.agent.registerTool` + locales，不涉及 coding-agent 内置工具的注册点）。用户在聊天里说「退回上一版」时，模型直接恢复而不是手改代码去拼凑旧样子。风险是它挑错版本，缓解是 `vetd_restore` 的返回值必须同时报出「已恢复到 X」和「恢复前状态已存为 Z」，让它能在用户说「不是这个」时立刻改正。

- **历史体积不主动修剪**：git 是内容寻址的，未改动的文件不重复存储，纯 tsx 设计几百个版本也只有几 MB；真正会胀的是 `assets/` 里反复替换的图片。自动丢弃最早的版本恰好会丢掉「一开始那一版」——最常被要求回到的那个。

- **超限时不询问用户，直接不带历史并告知**：原本的决定是「导出 `.vetdz` 时历史超过阈值就问用户带不带」。实现时没有落这条：宿主没有确认框 API（`ctx.ui.notify` 只有 toast，没有操作按钮），而导出有画布和画廊两个入口、分属不同 surface，各写一套确认框的成本远超这个场景的价值——超限本身极罕见。改成：超过 24MB（宿主 `readBinaryFile` 硬上限 32MB，留余量）就不带历史，并用 toast 说明原因，设计内容仍然完整。等宿主有了带按钮的确认能力再补上询问。

- **runner 静态引入，插件主 chunk 从 421KB 涨到 803KB**：动态 `import()` 能把这 380KB 拆成按需加载的独立块，但这个插件此前没有自己的动态 import 先例，异步 chunk 能否经 `vetta-plugin://` 取到没有被验证过——而它取不到时，表现是历史对所有人静默失效。在真实 Electron 里验证过之后可以随时拆回去（`runner-host.ts` 的注释里记了这件事）。
