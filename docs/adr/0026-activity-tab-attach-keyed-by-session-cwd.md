---
status: accepted
---

# 活动面板插件 tab 的 attach 作用域以会话 cwd 为 key

活动面板插件 tab（插件经 `registerActivityTab` 入池、用户手动 attach 才渲染的第三类 UI 扩展点）有两条作用域需求：普通项目内 attach 项目级共享（任一 session attach，该项目其他 session 同见）；默认「对话」项目（`~/.vetta/conversation`）内每个 session 彼此独立，attach 不得跨 session 同步。

决定：attach 记录（→ contribution 列表的 map）以**当前会话的 cwd** 为 key，而非「项目 cwd + 对话项目特判 sessionId」。依据是 ADR-0007 已经让两类项目的 session cwd 形态分化——普通项目所有 session 共享项目 cwd，对话项目每个新建 session 拥有独立子目录 `~/.vetta/conversation/<sessionId>/`——于是项目级共享与 per-session 隔离由同一个 key 自动成立，读写两端零特判。ActivityPanel 现成的 cwd 解析链（`cwdProp ?? activeSession?.cwd ?? null`）即取 key 处，cwd 为 null 时插槽整体不渲染。

被拒方案「项目 cwd 为 key + 对话项目特判」语义更显式，但特判要散布在读写两处，且未来再出现特殊项目形态时需逐个补判断。

后果与已接受的瑕疵：

- 本决策**寄生于 ADR-0007**——若对话项目 per-session cwd 机制变更，本机制的隔离语义随之失效，需同步重审。
- ADR-0007 不迁移老 session：对话项目里旧 session 的 cwd 仍是项目根，这些老 session 之间 attach 互相可见。存量有限、逐渐淘汰，明确不为其加特判。
- IM 会话查看器（SessionViewerPage，cwd 固定为 `~/.vetta/im-gateway/conversation`，见 ADR-0005）没有 per-session cwd，无法满足隔离语义，首期直接不支持插件 tab，而非给出跨 IM 会话串扰的错误行为。
- attach 记录持久化在 renderer localStorage（沿用 UI 偏好惯例）；插件卸载后记录残留无害，渲染取「attach 记录 ∩ 当前已注册 contribution」交集即可。
- `openActivityTab` / `setActivityTabVisible` 允许显式传入目标 cwd；tool handler 与后台任务必须使用其会话 cwd，避免前台会话在异步执行期间切换后把记录写到别的项目。不传时仍回退到当前显示会话，兼容 UI 事件调用方。
