# 实施日志：Read 参数化行为基线

本文件记录 Read 参数化行为基线的实施与验证。

## 2026-07-26：Read 参数化行为基线

### 目标

在实现新 read 之前，把旧工具的真实可观察行为提取为参数化合同，防止新架构只保留纯文本
happy path：

- 合同不绑定旧 AgentTool 调用签名。
- 旧实现先作为 Oracle 运行。
- 新实现完成后必须运行同一合同。
- 合同通过不等于新 read 已迁移。

### 修改范围

- 新增 `read-behavior-contract.ts`：
  - 定义中立的 Read Subject、Input、Options 和 Operations 测试接口。
  - 使用独立临时目录，不读取或修改生产会话数据。
  - 显式断言 read 的输出、错误、details、路径和 Operations 调用顺序。
- 新增 `read-legacy-contract.test.ts`：
  - 只在测试代码中适配旧 `createReadTool()`。
  - Adapter 只转换执行签名，不修改结果、错误或路径。
- 未新增 `src/coding/tools/read/`，避免在图片/WASM 语义尚未迁移时公开缩水实现。

### 合同覆盖

- 定义、Schema 关键字段、scope 和 category。
- UTF-8、GB18030、空文件和不存在文件。
- 相对、绝对、`~`、Unicode 空格及 CJK 空格模糊路径。
- macOS 窄空格、NFD、弯引号和 NFD + 弯引号组合。
- offset、limit、锚点行号、越界错误。
- 2000 行截断、50KB 首行截断、details 和 continuation notice。
- 图片魔数、默认 Photon 处理、关闭自动缩放、伪图片扩展。
- 已知扩展和无扩展二进制提示。
- 自定义 Read Operations 的路径与调用顺序。
- 已取消直接调用和执行中取消。

### 实施发现

- Windows 下旧 `~` 展开通过字符串拼接保留 `/`，会得到混合路径分隔符。合同记录真实结果，
  不在架构迁移中静默标准化。
- 一份旧 1×1 PNG fixture 可以通过魔数识别，但 Photon 无法解码。默认图片成功合同改用仓库
  中可被 Photon 解码的有效 PNG；“识别成功但处理失败”仍属于独立行为，不与成功路径混淆。
- read 的默认图片路径依赖 Photon/WASM。新实现不能只复制文件读取逻辑后宣称图片兼容。

### 明确未修改

- 未修改旧 read 源码或生产工具注册。
- 未实现或导出新 Runtime read。
- 未改变 TypeBox Schema、描述、路径、图片或取消行为。
- 未增加 runtime-tools 的 Photon/file-type 生产依赖。
- 未切换 RuntimeHost、Desktop、CLI、RPC 或 IM。

### 测试

- `packages/runtime-tools`
  - `bunx vitest --run test/coding/read/read-legacy-contract.test.ts`
  - 1 个测试文件、18 个测试通过。
  - `bun run test`
  - 3 个测试文件、27 个测试通过。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- read 迁移从“凭实现理解重写”改成“由旧行为合同驱动实现”。
- 新 read 可以通过新增 Runtime Adapter 直接复用同一套 fixture。
- 旧生产功能保持不变，read 仍明确标记为未迁移。

### 下一步

1. 在 `tools/read/` 内实现新 Runtime read，生产代码不导入旧 `coding-agent`。
2. 将路径、锚点、截断和文本解码放在可被后续 read/edit/grep 复用的包内模块。
3. 为图片处理建立默认 Adapter，并验证 Photon/WASM 的包发布与宿主打包路径。
4. 新旧实现同时通过 Read Behavior Contract 和 Tool Compatibility Contract 后再注册到 Feature。
