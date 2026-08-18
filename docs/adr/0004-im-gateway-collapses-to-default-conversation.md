# im-gateway 取消项目路由，统一收敛到默认「对话」cwd

旧版 im-gateway 用 `(im_user, project)` 作 session 路由 key，IM 用户必须 `/projects` + `/use <name>` 才能开聊，项目列表读自 `~/.vetta/desktop-config.json`。这给 IM 场景增加了一层 desktop 上才有意义的概念，导致首聊门槛高、跨设备体验割裂。

决定：IM 侧彻底移除「项目」概念。所有 IM session 一律落在 [[conversation cwd]] (`~/.vetta/conversation`)，路由 key 改为 `(im_user, chatID)`——一个 IM 聊天窗口对应一条 session。`/projects` `/use` 命令删除，`/new` 保留（语义改为「在对话 cwd 下开一条新 session」），`/whoami` `/help` 保留。

hostproto 破坏性升级：`InitFrame.Projects` 与 `ProjectsUpdateFrame` 删除，`InitFrame` 新增必填 `conversationCwd`，由 desktop 在启动 sidecar 时下发 `DEFAULT_CONVERSATION_CWD`。`internal/projects` 包一并删除。旧 `state.json` 检测到 legacy 格式即清空，旧 .jsonl 文件不动（desktop 仍可见）。

跨包改动：coding-agent `SessionHeader` 新增可选 [[session origin]] 字段，RPC 接受 `--origin im` 启动参数；im-gateway 创建 session 时带上。desktop sidebar 据 `header.origin === "im"` 给「对话」项目下的 session 加 badge。

权衡：放弃了「IM 也能切项目」的灵活性，换来 ChatGPT/openclaw 式的零门槛入口，也让 IM 不再依赖 desktop 的项目配置文件。未来如果重新需要 IM 切项目，会是一次正向加法而不是回退。
