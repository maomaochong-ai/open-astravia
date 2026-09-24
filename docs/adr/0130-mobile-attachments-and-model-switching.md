# ADR-0130：手机端上传附件与切换模型、思考强度

## 状态

已接受（在 ADR-0128 的协议 v2 上增量扩展，不改变已有请求、事件的形状）

## 背景

iPhone 客户端的聊天页需要：随消息附带相册图片和文件；在顶部切换会话使用的模型和思考强度。协议 v2 的 `session.prompt` 只带 `text`，也没有列出模型或修改会话设置的请求。

桌面端 composer 发送附件时并不内联内容：图片先落盘，再与文件一起以绝对路径的形式放进 `PromptRequest.attachments`（`{ kind, path }`），由 Agent 按需用工具读取。手机没有桌面上的文件路径，只能把字节传过去。

中继单条 WebSocket 消息上限 1.5M 字符，协议对密文另有 1.4M 字符的上限。换算下来，一个加密帧里的 JSON 明文约 1.05 MB，base64 之后单个附件的原始数据约 780 KB 封顶。

## 决策

- **附件逐个上传，按 id 引用**。新增 `session.upload`，载荷为 `{ kind: "image" | "file", name, mimeType, data(base64) }`，解码后不超过 `REMOTE_MAX_UPLOAD_BYTES`（700 KB），返回 `{ uploadId }`。`session.prompt` 新增可选的 `attachments: uploadId[]`。
  - 桌面端把上传写到 `~/.vetta/remote-uploads/<会话键>/<随机目录>/<清洗后的文件名>`，然后按桌面拖入文件时的方式交给运行时：`{ kind, path }`。
  - uploadId 只能在上传所属的会话里使用，而且只能用一次。30 分钟内没被引用就作废。
  - 超过 7 天的上传目录在下次写入时清理。
- **手机端负责把附件压到帧内**。图片重新编码为 JPEG，逐步缩小尺寸直到不超过 700 KB。其他文件超过 700 KB 直接提示放不下，不做分片。一次最多 6 个附件。
- **模型与思考强度**：
  - 新增 `model.list`，返回会话可用的模型：`key`（`provider/modelId`）、名称、可选的思考强度和是否支持图片。思考强度菜单与桌面一致：模型有推理能力时，在预设强度前加 `off`；如果模型自带 `none`，就用 `none` 代替 `off`。
  - 新增 `session.configure { modelKey?, thinkingLevel? }`，调用运行时的 `updateSettings`，返回并广播新的 `session.state`。会话正在跑一轮时拒绝修改（`busy`）。
  - `session.state` 新增 `modelKey`、`thinkingLevel` 两个可选字段。
- TypeScript 包、JSON Schema、`VettaKit` 同时更新，联调夹具同步支持。联调测试会通过真实中继上传一个正好 700 KB 的附件。

## 备选方案

- **附件内联在 `session.prompt` 里**：几张照片就会超过单帧上限，而且一个请求失败要整体重传。
- **分片上传大文件**：需要额外的会话状态、重组逻辑和清理机制。手机端发送的主要是截图和照片，压缩后都在上限以内，暂不值得。
- **只在每轮 prompt 里附带 `modelKey`/`reasoning`**：桌面 composer 用的就是这种方式，但手机需要在发消息之前就让标题显示当前选择，而且切换应该对会话持续生效，所以改为显式的 `session.configure`。

## 后果

- 旧的手机端不发送新请求，照常可用。旧的桌面端会以 `invalid_frame` 拒绝未知方法，新手机端遇到时按普通错误提示。
- 超过 700 KB 的非图片文件目前无法从手机发送。
- 手机上传的文件会在桌面磁盘上保留最多 7 天。
