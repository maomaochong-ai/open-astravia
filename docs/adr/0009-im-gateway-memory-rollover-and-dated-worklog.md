---
status: accepted
---

# im-gateway 记忆系统：MEMORY.md 常驻记忆 + 会话滚动取代原地压缩 + 日期工作史

IM 用户大量时间在飞书/微信聊天，但 Claw 的会话之间没有任何关联与记忆：换一个聊天窗或 `/new` 就从零开始，agent 不记得用户是谁、在做什么；同一条 session 聊久了无限增长，逼近 coding-agent 的 [[Layer2 压缩]] 阈值（贴近上下文 80%）后**每一轮都会再次触发压缩**——又慢又持续掉信息；产物（agent 生成的 html/py/md）全堆在共享 cwd 根，纯 IM 端无 UI 无从管理。目标是做成 OpenClaw / Hermes 那种「看上去一直在同一个会话」的记忆体验。

参考 Hermes 的实现（四层栈：MEMORY.md/USER.md 策展记忆冻结快照 + SQLite/FTS5 会话检索 + ContextCompressor 五阶段压缩 + 外部 provider），提炼出连续体验的三根支柱：① 记忆文件作为冻结快照常驻 system prompt；② 压缩前 `flush_memories()` 抢救事实；③ `session_search` 深度召回。**Hermes 本身不做 session 滚动**——它始终是同一条 session 原地压缩，连续感来自记忆 + 召回而非会话文件的单一性。

## 决定

引入门控 [[memory-mode]]（拟 `--memory-mode` 启动参数，默认关），**仅 im-gateway 为 [[im-gateway cwd]]（Claw，单 owner 的固定唯一项目）spawn coding-agent 时传入**；desktop / TUI 永不传，行为完全不变。靠显式 flag 而非 cwd 探测，不引入「按目录猜行为」的魔法，与 `--enable-host-bridge`（ADR-0006）是两个正交门控。记忆归属为**项目级单一**，不区分 user/project、不考虑多租户。

memory-mode 下启用三层：

1. **常驻记忆 [[MEMORY.md]]**：[[im-gateway cwd]] 根下单文件，~4000 字上限（合并掉 Hermes 的 USER.md，单 owner 下无意义区分），由 `resource-loader` 启动时**作为冻结快照**注入 system prompt（复用现有 AGENTS.md/CLAUDE.md 通道）。冻结快照是硬纪律——保住 Anthropic 前缀缓存；因 `closeOnIdle` 每条消息重启进程，「下一次加载」≈ 下一条 IM 消息，记忆跨消息近实时生效。写入靠 [[memory 工具]]（add/replace/remove）随时写 + [[memory flush]]（rollover 前抢救）保底。

2. **[[session rollover]] 取代 [[Layer2 压缩]]**（阈值 ~70%）：保留免费的 [[Layer1 microcompact]]；到阈值不在原 jsonl 原地 LLM 压缩，而是 flush → 复用 compaction 现成逻辑生成「近期尾巴（`keepRecentTokens` ~20k）+ 摘要」→ 写进**新 jsonl**，`SessionHeader.parentSession` 指回旧文件。承接进新会话 = 尾巴 + 摘要 + MEMORY.md。rollover 时 coding-agent 发 path-changed 事件，im-gateway 更新路由 state。`session_search`（借 parentSession 链跨 jsonl 回溯）延后二期，一期只留指针。

3. **[[日期工作史]]**：agent 运行 cwd 设为今日日期目录 `<im-gateway cwd>/<YYYY-MM-DD>/`（写 `./` 落今日、读 `../<昨天>/` 回溯），与 [[im-gateway inbox]] 日期目录同构；每个日期目录一份 [[JOURNAL.md]]（每 turn-end append 一行 + rollover 写一段）。「问 agent 昨天干了什么」由 agent 自助翻昨日目录成立；产物即记忆。flush/摘要模板须显式收录关键产物及路径，这才让「跨 rollover 记住产物」真正成立。`--session-dir` 须钉死为绝对 `<cwd>/.astravia/sessions/`，不随日期 run-cwd 漂。

## 关键取舍

**为何滚动而非照搬 Hermes 的原地压缩。** Hermes 是长驻进程；im-gateway 是 `closeOnIdle`，**每条 IM 消息 spawn 新进程并全量解析整条 jsonl**，而原地压缩只追加 `compaction` entry、不截断文件 → jsonl 无限增长 → 每条消息冷启动解析成本随时间上涨。rollover 给单文件大小封顶——这是 im-gateway 专属、Hermes 不付的成本。记忆/flush/承接照搬 Hermes 解决「记什么、连续感」；rollover 是叠加其上的 im-gateway 优化，二者正交。

**为何门控而非 coding-agent 通用特性。** 用户范围明确只针对 Claw 这一个项目，且 rollover 会改变 desktop/TUI 现有压缩行为。门控把改动面收在 IM，desktop/TUI 零影响；未来若要推广是一次正向加法。

**为何按日期而非 per-session 隔离产物。** 借鉴 ADR-0007 desktop 的 per-cwd 隔离，但 IM 用户的心智是「昨天/今天干了什么」而非「哪条 session」，日期是更自然的回溯轴，且与 inbox 已有的日期目录同构。代价是同一条 session 的产物会散在多个日期目录——可接受，因为 session 是对话线、日期是工作发生的时间。

## 后续若改变主意

- 若 Read/翻目录式召回对 IM 体验不可接受，按 ADR-0006 末尾口径给 transport 加 capability，而非推翻单轨；
- 若需要桌面查看/接管 IM 记忆会话，作为独立桥接特性正向加回（同 ADR-0005 口径），而非合并 cwd；
- `session_search` 二期落地时，parentSession 链已就位，无需回改一期结构。
