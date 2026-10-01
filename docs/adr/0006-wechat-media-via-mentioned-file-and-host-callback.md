---
status: accepted
---

# wechat 图片/文件收发：入站走 mentionedFile 单轨，出站走 host_request 反向 RPC

im-gateway 的 wechat transport 此前只跑文本（ADR-0005 之后的 M1 范围），`docs/ilink-protocol.md §7` 把媒体（image/file/voice/video）明确列为不实现。这一轮要把 image + file 双向收发加上（voice/video 仍延后；feishu 不在范围）。

> **范围更新**：本 ADR 的「feishu 不在范围」已被 ADR-0008 推翻——feishu 现已复用同一套 inbox + host_request 单轨，并新增 post 富文本入站。本文其余决策（单轨 vs `images[]`、工具回调 vs digest 扫描）仍是两个 transport 的共同基础。

设计上有两个非平凡决定。

**入站统一走 [[mentionedFile]] 单轨，不走 RPC `images[]`。** 一开始的方案是把图片解密后 base64 直接塞进 `prompt.images[]`（多模态视觉直投），同时也落盘以便 agent 二次编辑——即"图片双轨"。复盘时发现 coding-agent 的 `Read` 工具早就有完备的图片处理 (`packages/coding-agent/src/core/tools/read/index.ts` + `resizeImageBuffer`，默认缩到 2000x2000)，由 im-gateway 再做一份 Go 侧的解码/缩放是重复造轮子；同时把原始 base64 塞 stdin 会面临 ~50 MB 单行 JSON、爆 session jsonl、踩 LLM provider 大小上限的风险。所以入站统一改为：图片 + 文件都只把**原样字节**落盘到 [[im-gateway inbox]] (`~/.astravia/im-gateway/conversation/<YYYY-MM-DD>/`)，bridge 在 `prompt.message` 头部 prepend 一行 `@<abspath>`，agent 想看图就调 Read，bridge 不参与缩放。代价是 agent "看见"图片要多花一次工具调用，不再是上来就能视觉读取——值得，换来 Go 侧零图像依赖、可控的 RPC payload 大小、对所有 IM 媒体统一处理。

**出站走 coding-agent 内置工具 `im_send_attachment` + 新增的 `host_request / host_response` 反向 RPC 通道。** 候选方案有三：(A) 在 turn-end digest 文本里扫描 markdown / `@path` 自动抽出附件；(B) 给 agent 注册显式工具，工具体回调宿主真实发送；(C) cwd diff，把本轮新生成的文件都发出去。A 靠正则脆弱、容易误伤其它入口的输出风格；C 隐式魔法，中间产物会被误发。选 B：agent 显式 `im_send_attachment({path, kind, caption?})`，工具体通过新协议同步等宿主（30s 超时）真实发送结果，agent 拿到 `messageId` 或结构化 error（`quota_exhausted` / `peer_unreachable`）再决定收尾文本怎么说，避免"声称已发实际没发"。代价是 coding-agent 主包多一个 wechat-aware 的工具文件，且 RPC 协议要加一对反向消息——通过工具仅在 `--mode rpc --enable-host-bridge` 时注册来限制污染面，TUI / CLI / desktop 启动的 agent 看不见这个工具。

新增的反向 RPC 一对：

- agent → host（stdout event）：`{"type":"host_request","id":"hr-N","method":"send_attachment","params":{...}}`
- host → agent（stdin command）：`{"type":"host_response","id":"hr-N","success":bool,"data":{...},"error":""}`

`method` 字段预留扩展（未来可能 `send_typing` / `query_peer_info` 等），共用 stdin/stdout 靠 `type` 区分。

其它一锤定音的细节：AES-128-ECB / 16 字节 raw key / PKCS7 / 无 IV，与上游 ts 实现对齐；不生成 thumbnail，`getuploadurl` 始终传 `no_need_thumb=true`（聊天列表预览可能显示默认块但点进去正常）；一个 attachment 算 1 次 quota，与 digest 文本独立计数、共用同一个 per-peer 计数器，quota 用尽工具返回 `quota_exhausted` 由 agent 决定后续。落盘的文件不做自动清理（等需要时再补 TTL 策略）。

如果未来重新发现必须走多模态直投（比如 Read 调用对 IM 用户体验不能接受），应当作为一个新选项加回——给 transport 加一个 capability 控制"入站图片是否同时进 `images[]`"，而不是替换掉 [[mentionedFile]] 单轨。
