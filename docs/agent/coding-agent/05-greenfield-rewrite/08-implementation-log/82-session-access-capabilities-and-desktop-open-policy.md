# 第 82 轮：会话访问能力与 Desktop 打开策略

## 1. 本轮目标

让 Desktop 根据宿主显式声明的会话能力选择交互页面或只读 Viewer，不再根据 IM cwd、文件名或具体
Backend 名称推断“能否交互续跑”。

成功标准：

1. 访问能力合同不包含 Legacy、Greenfield、IM 或存储格式。
2. 能力由 Desktop Composition Root 组合，Storage Catalog 不决定交互策略。
3. Legacy 会话继续进入交互 Runtime。
4. Greenfield IM 会话继续进入只读 Viewer。
5. Renderer 和主进程同时阻止只读会话进入活动 Backend。
6. rename/delete 继续由第 81 轮的 Catalog 路由，并受能力合同保护。

## 2. 实施前审计

第 81 轮完成混合 Catalog 后，实际打开策略仍有两个隐式分支：

- 普通项目列表通过 `session.cwd === imCwd` 判断 Viewer。
- 默认 Claw 列表通过 `sessionPath.startsWith(imCwd)` 判断 Viewer。

这两个判断把三个不同概念绑定在一起：

```text
物理目录位置
  ≠ 存储格式
  ≠ 当前宿主是否具备交互续跑能力
```

Viewer 页面内部仍使用 cwd 区分“实时更新”和“只读”徽标，但这只是展示语义，不参与打开决策，本轮没有
把它误当成 Runtime 能力。

## 3. Runtime 能力合同

Runtime Core 新增：

```ts
interface RuntimeSessionAccess {
  readHistory: boolean
  interactiveResume: boolean
  rename: boolean
  delete: boolean
}
```

同时新增：

- `RuntimeSessionAccessResolver`
- `RuntimeSessionAccessRoute`
- `CatalogRoutedRuntimeSessionAccessResolver`

解析流程为：

```text
sessionPath
  └─ Catalog.ownsSession(path)
      └─ Composition Root 声明的 RuntimeSessionAccess
```

Catalog 只回答“文件是否属于我”；Composition Root 才回答“这个宿主准备为它提供什么能力”。

`RuntimeHost.resolveSessionAccess()` 只解析能力，不打开文件、不创建 Session Handle、也不获取写锁。

## 4. 能力与动态可用性

能力表示宿主是否实现某项操作，不表示操作此刻一定成功：

- `rename: true` 表示存在正确的重命名实现。
- Sidecar 正持有 `.owner.lock` 时，重命名仍会因 ownership conflict 暂时失败。
- ownership lease 释放后，不需要重建能力合同，操作可以再次成功。

因此没有把 `externallyOwned` 放进稳定能力对象；它属于动态占用状态，应由实际写操作或后续独立状态查询表达。

## 5. Desktop Composition

Desktop 显式注册两条能力路由：

```text
Legacy Catalog
  readHistory       = true
  interactiveResume = true
  rename             = true
  delete             = true

Greenfield IM Catalog
  readHistory       = true
  interactiveResume = false
  rename             = true
  delete             = true
```

能力对象没有暴露 Backend 名称。未来 Greenfield Desktop Profile 完成后，只需由 Composition Root 改变能力
和活动 Backend 路由，不需要 Renderer 识别 Greenfield。

## 6. Desktop Application 与 Renderer

### 6.1 列表合同

Desktop 在既有 `SessionHistoryInfo` 外增加宿主级 `access`：

```ts
interface DesktopSessionHistoryInfo extends SessionHistoryInfo {
  access: RuntimeSessionAccess
}
```

核心 `SessionHistoryInfo` 和 Storage Catalog 返回值保持不变；访问能力只存在于 Desktop 应用合同。

无法解析归属时返回全 false 能力，fail closed，并且不会把格式字段传给 Preload 或 Renderer。

### 6.2 打开策略

共享纯函数把能力转换为页面目标：

```text
interactiveResume = true → interactive
interactiveResume = false 且 readHistory = true → viewer
其它 → unavailable
```

侧栏两个 cwd/path 分支均已删除。实际磁盘列表总是带显式能力；发送首条消息时产生的短生命周期乐观条目
可能尚未带能力，继续按既有交互会话处理，列表刷新后由主进程事实覆盖。

### 6.3 主进程保护

`DesktopConversationService.openSession()` 在调用活动 Backend 前再次解析能力：

- 无归属：`INVALID_SESSION_PATH`
- 只有历史读取：`SESSION_READ_ONLY`
- 支持交互续跑：继续验证 Legacy header 并按原链路打开

因此即使绕过侧栏直接调用 IPC 或 Debug Conversation，也不能把 Greenfield Conversation 文件交给
Legacy `SessionManager.open()`。

Debug Conversation 将 `SESSION_READ_ONLY` 映射为输入错误，保持其错误转换穷尽。

### 6.4 写操作保护

当配置了 Access Resolver 时，`RuntimeHost.renameSession/deleteSession` 会先检查对应能力。没有配置 Resolver
的既有宿主保持原行为，避免本轮扩大兼容性变化。

能力检查通过后仍进入第 81 轮的 Catalog 和 ownership/write-lock 逻辑。

## 7. TypeBox / Zod 判断

本轮没有新增外部 JSON 或持久化格式：

- `RuntimeSessionAccess` 是进程内 TypeScript 合同。
- 能力值由 Composition Root 静态构造。
- Preload 只传递主进程生成的对象，不接收 Renderer 提交的能力声明。

因此不需要 TypeBox 或 Zod。持久化文件仍由第 81 轮复用的 TypeBox schema 校验。

## 8. 测试

新增或扩展的门禁：

1. Runtime Core：
   - 根据 Catalog ownership 解析不同能力。
   - 未知文件返回 `undefined`。
   - `rename/delete` 按能力 fail closed。
   - 既有混合目录、历史读取与 Legacy 行为继续通过。
2. Desktop：
   - interactive 能力选择交互页面。
   - history-only 能力选择 Viewer。
   - 全 false 能力选择 unavailable。
   - 会话列表附加宿主能力。
   - history-only 会话在调用活动 Backend 前返回 `SESSION_READ_ONLY`。
3. 类型与质量：
   - 根 `tsgo --noEmit`。
   - Desktop 独立 `tsc --noEmit`。
   - `check:quick` 与完整 `check`。

## 9. 明确未修改

- Desktop 活动 Backend 仍是 Legacy。
- Greenfield IM 仍由 Sidecar RPC 负责交互续跑。
- 没有为 Greenfield 声明尚未实现的 Desktop 交互能力。
- 没有改变 Session 文件格式、Catalog 格式识别或 ownership 语义。
- 没有改变 Provider、Tool、Prompt、Skill、MCP、Memory、Todo、Subagent 或 sandbox 功能。
- 没有切换默认 Runtime。

## 10. 下一步

下一阶段应建立 Greenfield Desktop Profile 的能力差分门禁，而不是直接把
`interactiveResume` 改为 `true`：

1. 枚举 Desktop 活动会话实际消费的 Session Ports。
2. 用同一组场景测试 Legacy 与 Greenfield Assembly。
3. 补齐历史编辑、模型控制、宿主交互、插件重配置、工作管理和路径恢复差距。
4. 在完整 Profile 通过差分测试后，新增显式 Desktop Greenfield opt-in。
5. 最后验证 Sidecar crash/restart、owner lease 回收和 fallback，再讨论默认切换。
