# 第 90 轮：Desktop Greenfield 显式接入与宿主差分门禁

## 1. 目标

第 89 轮已经完成 Subagent 状态日志与恢复，但 Desktop 生产组合仍只有 Legacy
Backend。现有 `DesktopGreenfieldRuntimeCandidate` 又固定绑定单一工作区和场景，
不能直接替换进程级共享 `RuntimeHost`。

本轮作为一个完整阶段完成：

1. 保持唯一的 Desktop 进程级 `RuntimeHost`。
2. 增加默认关闭、启动时确定的 Greenfield selector。
3. 新会话按 selector 选择默认 Backend，既有会话按持久化格式归属路由。
4. 支持多个工作区、会话目录和场景对应的 Greenfield Composition。
5. 保持 IM Greenfield 会话只读，Desktop Greenfield 会话允许交互恢复。
6. 统一应用退出时 RuntimeHost、Session 和 Greenfield Composition 的释放顺序。
7. 建立 Legacy/Greenfield 的 Desktop 宿主差分门禁。

## 2. 关键判断

### 2.1 Candidate 不能成为第二个生产 RuntimeHost

Desktop 的交互会话、Scheduler、Batch 和插件配置必须共享一个 RuntimeHost，否则同一
进程内会产生重复文件锁和相互不可见的活动 Session。

因此本轮没有把 Candidate 单独挂到 IPC，而是把它的 Greenfield 组合能力下沉为
`DesktopGreenfieldRuntimeBackendPool`。Candidate 和生产入口都复用该池。

### 2.2 Backend Pool 只缓存 Composition 固定参数

缓存键包含：

- canonical `cwd`；
- canonical `conversationDir`；
- canonical `agentDir`；
- `scenario`；
- `enableSubagents`；
- `serverUrl`。

模型、thinking level、execution mode、环境变量、插件、Skill、用户提问能力和 prompt
都属于会话请求，不进入缓存键。

这避免两个错误：

- 缓存键过小，导致固定 Composition 拒绝另一个工作区或场景的请求；
- 缓存键过大，导致每个会话都创建一套长期资源。

### 2.3 格式归属与宿主访问策略分离

`FileConversationRuntimeSessionCatalog` 继续负责 Greenfield 文件格式识别和存储操作。
Desktop 新增的 Catalog Adapter 只负责：

- 从当前项目配置动态解析会话根；
- 为普通项目补齐 `cwd/.vetta/sessions` 默认目录；
- 用路径过滤视图区分 IM 与 Desktop Greenfield 路由。

没有把 Desktop 项目配置或路径规则下沉到 `runtime-storage` / `runtime-core`。

## 3. Desktop Runtime selector

新增启动环境变量：

```text
VETTA_DESKTOP_AGENT_RUNTIME=legacy
VETTA_DESKTOP_AGENT_RUNTIME=greenfield
```

语义：

- 未设置、空值或 `legacy`：默认 Backend 为 Legacy；
- `greenfield`：新会话默认使用 Greenfield；
- 其他值：启动组合时明确失败；
- selector 只决定无 `sessionPath` 的新会话；
- 已有 Legacy/Greenfield 文件始终按 Catalog ownership 路由；
- 不存在自动或静默 Legacy fallback。

本轮没有增加设置页 UI，也没有把实现名称加入中立的 `SessionConfig`。

## 4. 进程级 Greenfield Backend Pool

新增：

- `desktop-greenfield-runtime-backend-pool.ts`

职责：

1. 从 `RuntimeSessionCreateRequest` 解析 Composition scope。
2. 并发请求同一 scope 时复用同一个创建 Promise。
3. 为每个 scope 创建真实 `createGreenfieldRuntimeComposition()`。
4. 用 `GreenfieldRuntimeHostSessionBackend` 交付完整 Assembly。
5. Candidate 诊断可以读取已交付的 Session 和 Assembly assessment。
6. 应用退出时等待在途 Composition 创建并释放所有成功创建的 Composition。
7. Pool 进入 disposed 状态后拒绝新 Session，释放失败聚合后上抛。

新项目未传 `sessionDir` 时使用：

```text
<cwd>/.vetta/sessions
```

恢复已有会话时以 `sessionPath` 的父目录作为真实 Conversation Directory，避免项目路径、
默认对话路径和显式目录之间发生猜测。

## 5. Desktop 生产组合

`packages/desktop-app/src/main/runtime.ts` 现在组合：

```text
shared RuntimeHost
  └─ CatalogRoutedRuntimeHostSessionBackend
      ├─ existing Legacy file -> Legacy Backend
      ├─ existing Desktop Greenfield file -> Greenfield Backend Pool
      └─ new session
          ├─ selector=legacy -> Legacy Backend
          └─ selector=greenfield -> Greenfield Backend Pool
```

以下行为保持不变：

- `getSharedRuntime()` 仍返回唯一进程级实例；
- shared ModelRegistry 仍只创建一次；
- RuntimeHost 继续负责同路径活动会话去重；
- Scheduler、Batch 和交互会话继续消费同一 RuntimeHost；
- Plugin invoker、用户提问、沙箱路径和 Skill 路径继续由 RuntimeHost 请求传入。

`disposeSharedRuntime()` 现在先释放 RuntimeHost 的活动 Session，再释放 Backend Pool
中的所有 Composition；即使前一步失败，也会执行后一步。

## 6. Catalog 与访问能力

新增：

- `desktop-greenfield-session-catalog.ts`

生产目录组合会动态读取：

- 默认对话根；
- IM 对话根；
- Knowledge Processing 根；
- 当前项目；
- 已归档项目。

访问策略：

| 文件归属 | 历史读取 | 交互恢复 | 重命名 | 删除 |
| --- | --- | --- | --- | --- |
| Legacy | 是 | 是 | 是 | 是 |
| Desktop Greenfield | 是 | 是 | 是 | 是 |
| IM Greenfield | 是 | 否 | 是 | 是 |

IM 路径不会注册到 Desktop Greenfield Session Backend 路由，因此即使内部调用绕过
`DesktopConversationService.openSession()`，也不会被 Desktop Backend 恢复。

## 7. Greenfield Header 恢复

`readDesktopSessionHeader()` 原来只识别 Legacy：

```json
{ "type": "session", "cwd": "..." }
```

现在同时识别 Greenfield：

```json
{ "recordType": "conversation.header", "cwd": "..." }
```

两种格式都继续要求绝对 `cwd`。格式归属已经在此前的 Catalog access 检查中完成，
该函数只投影 Desktop 恢复所需的工作目录。

同时移除了 `session-paths.ts -> ipc/fs.ts` 的不必要聚合依赖，改为直接读取配置常量源，
避免解析一个 Header 时加载完整 IPC 和 Runtime 组合。

## 8. Candidate 收敛

`DesktopGreenfieldRuntimeCandidate` 不再自己创建和持有独立
`GreenfieldRuntimeComposition + GreenfieldRuntimeHostSessionBackend`。

现在它：

- 使用和生产入口相同的 `DesktopGreenfieldRuntimeBackendPool`；
- 仍通过真实 RuntimeHost 和 Catalog 路由；
- 仍限制 Candidate 的单一工作区测试语义；
- dispose 时先释放 RuntimeHost，再释放 Pool。

因此 Candidate 继续是非生产验证外壳，但不再复制生产组合逻辑。

## 9. 测试

新增或扩展六组 Desktop 定向测试：

1. selector 缺省 Legacy、显式 Greenfield、非法值拒绝；
2. Legacy/Greenfield Header 读取和非法 cwd 拒绝；
3. IM/Desktop Greenfield 路径归属隔离；
4. 同 scope 复用、多工作区/多场景隔离、默认目录列举和 disposed gate；
5. 同一共享 RuntimeHost 重复打开去重、销毁 Pool 后模拟应用重启恢复；
6. Legacy/Greenfield 真实 RuntimeHost 宿主差分：
   - 创建；
   - State；
   - Messages/History；
   - thinking、steering、follow-up 更新；
   - 重复 dispose；
   - 文件恢复。

执行：

```text
cd packages/desktop-app
bunx vitest --run \
  src/main/greenfield-runtime/desktop-runtime-selector.test.ts \
  src/main/conversations/session-paths.test.ts \
  src/main/greenfield-runtime/desktop-greenfield-session-catalog.test.ts \
  src/main/greenfield-runtime/desktop-greenfield-runtime-backend-pool.test.ts \
  src/main/greenfield-runtime/desktop-greenfield-runtime-candidate.test.ts \
  src/main/greenfield-runtime/desktop-runtime-host-differential.test.ts
```

结果：

- 6 个测试文件通过；
- 14 个测试通过。

额外验证：

```text
bun run check:quick
bun run check
```

结果：

- Biome 无错误、警告和 info；
- monorepo `tsgo --noEmit` 通过；
- CLI 独立类型检查通过；
- Desktop `tsc --noEmit` 通过；
- Admin `tsc -b` 通过；
- 全部 quality guards 通过。

## 10. 明确未修改

- 没有改变 Desktop 缺省 Legacy 行为。
- 没有增加设置页 UI 或用户可见文案。
- 没有自动迁移 Legacy 文件到 Greenfield。
- 没有让 Legacy 读取 Greenfield 文件，也没有让 Greenfield 读取 Legacy 文件。
- 没有为失败请求增加静默 fallback。
- 没有删除 Candidate 或 Legacy Backend。
- 没有修改 Tool、MCP、Skill、Knowledge、Plugin 或 Subagent 的功能语义。
- 没有把 Desktop 路径策略放入内核包。

## 11. 下一步

下一阶段应实施“Desktop 真实回合与宿主外围能力 Canary 门禁”，仍保持默认 Legacy：

1. 通过 Desktop 共享组合对 Legacy/Greenfield 执行确定性模型 Tool Loop 差分。
2. 覆盖用户提问、Plugin Tool/System Prompt/Continuation 和动态移除。
3. 覆盖前台命令、后台命令、Todo、Subagent 的终止与清理。
4. 覆盖 Scheduler、Batch 与交互 Session 同进程并存时的 ownership 和退出。
5. 增加可诊断但不含敏感信息的选中 Backend/失败阶段日志。
6. 完成真实宿主 Canary 后，再决定是否把 Greenfield opt-in 暴露为设置项；在此之前不切换默认值。
