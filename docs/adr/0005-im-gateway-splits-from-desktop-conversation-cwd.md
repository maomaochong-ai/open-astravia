---
status: accepted (supersedes 0004 in part)
---

# im-gateway 与 desktop「对话」cwd 彻底分家

ADR-0004 把 IM session 收敛到 desktop 的「对话」cwd（`~/.vetta/conversation`），并通过 `SessionHeader.origin` + sidebar badge 在桌面端混合展示 IM/desktop 两类 session。实际运行后这一形态暴露两个问题：(1)「窜味」——agent 生成的产物（html/py/md 等）落到同一 cwd 顶层，桌面「对话」和 IM 互相看到对方的工件；(2) 强耦合——未来若 IM 侧要独立加记忆/profile/skills，混在同一 cwd 里非常难拆。

决定：im-gateway 启用独立 cwd `~/.vetta/im-gateway/conversation/`，与 desktop「对话」cwd (`~/.vetta/conversation`) 物理分离。两边的 sessions（`<cwd>/.vetta/sessions/`）与产物各自独立，桌面「对话」侧栏不再展示 IM session。`SessionHeader.origin` 字段、对应 RPC `--origin` 启动参数、desktop sidebar 的 IM badge 一并移除（不再有混合展示场景，字段就成了死代码）。

不做兼容/迁移：老的 `~/.vetta/conversation` 下 IM 残留 .jsonl 留在原处由 desktop 渲染；im-gateway 的 `state.json` 残留 SessionPath 是死引用，下一次该 chat 来消息时按"新会话"重启。假设没有用户在 `im-gateway/config.yaml` 里显式写过 `conversationCwd`（旧默认值即将作废，显式配置者照旧生效）。

ADR-0004 中"IM 路由 key = `(im_user, chatID)`、`/projects` 删除、hostproto 下发 `conversationCwd`"等结论保持有效。本 ADR 仅推翻其中"共用默认 cwd + origin badge 混合展示"的部分。

权衡：放弃了"用户在桌面端能直接接管/旁观 IM 会话"的产品形态，换来产物互不串味与未来 IM 侧独立演化（记忆、profile 等）的解耦空间。如果未来重新需要"桌面查看 IM 会话"，应当作为一个独立的桥接特性正向加回来，而不是退回共享 cwd。
