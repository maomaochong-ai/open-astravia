# 实施日志：独立 Runtime Read 与 Feature 接入

本文件记录独立 Runtime Read 与 Feature 接入的实施与验证。

## 2026-07-26：独立 Runtime Read 与 Feature 接入

### 目标

在不修改旧生产工具和用户可观察功能的前提下，完成 read 的独立 Runtime 实现：

- 新实现不导入 `coding-agent`。
- 保留旧描述、Schema、路径、编码、图片、二进制提示、锚点、截断和取消行为。
- 环境依赖通过 Port 注入，纯行为算法与具体工具装配分离。
- 只有旧新合同通过后才加入 Greenfield Coding Tools Feature。

### 修改范围

- 新增包内纯行为模块：
  - `shared/anchors.ts`
  - `shared/path-resolution.ts`
  - `shared/text-decoding.ts`
  - `shared/truncation.ts`
- 新增独立 read 目录：
  - `read-tool.ts`
  - `description.ts`
  - `registration.ts`
  - `image-mime.ts`
  - `image-resize.ts`
  - `photon.ts`
  - `index.ts`
- 新增 `ReadImageProcessor` Port；默认 Adapter 保留 Photon/WASM 图片处理。
- `ReadOperations` 继续隔离 stat、readFile 和 MIME 检测。
- `runtime-tools` 增加 `file-type` 与 `@silvia-odwyer/photon-node` 直接生产依赖。
- `createCodingToolsFeature()` 新增 cwd/read options，并注册 `current_time` 与 `read`。
- 新增新实现行为合同、旧新差分和真实 Engine Tool Loop 测试。

### 架构边界

```text
CodingToolsFeature
  -> CodingToolRegistration
    -> Runtime Read Tool
      -> shared pure behavior
      -> ReadOperations
      -> ReadImageProcessor
```

- Kernel 只看到 `RuntimeToolDefinition`，不认识 read 的文件系统或 Photon。
- Coding 注册层持有 scope/category，不污染 Tool 执行定义。
- 默认 Adapter 决定如何访问文件和处理图片，但不能修改模型可见合同。
- shared 目录只保存已经被行为合同固定的无状态算法，不形成跨工具状态或服务定位器。

### 兼容性验证

- 同一组 18 项 Read Behavior Contract 同时运行旧实现和新实现：
  - UTF-8、GB18030、空文件和不存在文件。
  - 相对、绝对、`~`、Unicode/CJK 空格、NFD 和弯引号路径。
  - offset、limit、锚点、行截断和字节截断。
  - 图片魔数、Photon 默认处理、关闭自动缩放和伪扩展。
  - 已知/未知二进制提示、自定义 Operations 和取消。
- 旧新定义与注册逐字段比较。
- 锚点、截断文本和二进制提示执行结果逐字节比较。
- 注入 `ReadImageProcessor` 时验证处理器输入和返回结果不被 Adapter 改写。
- 真实 `AgentCoreTurnEngine` Tool Loop 成功读取 cwd 下的相对路径文件。

### 明确未修改

- 未修改包根旧 `createReadTool` 兼容导出。
- 未修改旧 `coding-agent` read 源码、描述文件或注册表。
- 未切换 RuntimeHost、Desktop、CLI、RPC 或 IM。
- 未修改旧路径的混合分隔符、模糊匹配或错误消息。
- 未删除旧独立可执行产物的 Photon WASM 复制逻辑。
- 未迁移 edit、write、grep、ls、bash 或其他工具。

### 测试

- `packages/runtime-tools`
  - `bunx vitest --run test/coding/read/read-runtime-contract.test.ts`
  - 1 个测试文件、21 个测试通过。
  - `bun run test`
  - 4 个测试文件、49 个测试通过。
- `bun run check:quick`
  - Biome、私钥、冲突标记和包边界检查通过。
- `bun run check`
  - Biome、monorepo tsgo、Desktop tsc 和全部 guards 通过。

### 结果

- read 的工具模块行为完成独立迁移，新源码不再通过兼容转发依赖旧工具。
- Coding Tools Feature 已从单一 `current_time` 扩展为 `current_time + read`。
- 文件系统、图片处理和纯文本算法边界显式化，同时保持旧功能。
- 生产入口仍使用旧实现，因此本轮没有造成用户可观察功能变化。

### 未解决问题

- Photon/WASM 已通过模块运行时测试，但尚未验证 Greenfield Host 独立可执行产物的资源复制和
  定位；生产切换前必须增加 Packaging Gate。
- Feature 仍缺少 edit、write、search、process 等旧工具，不能整体替代生产工具集合。
- shared 算法是否被其他工具复用，必须由其旧行为合同决定，不能预先抽象。

### 下一步

1. 为 `ls` 提取旧行为矩阵和参数化合同。
2. 在合同约束下实现独立 Runtime ls，按需要复用路径/截断纯模块。
3. 再迁移 `grep`，形成完整只读工具组。
4. 在宿主组合阶段补充 Photon WASM 独立产物测试，不把打包逻辑放回 read 工具。
# 实施日志：Ls 与 Tool Catalog

本文件记录独立 Runtime Ls 与动态 Coding Tool Catalog 相关实施。
