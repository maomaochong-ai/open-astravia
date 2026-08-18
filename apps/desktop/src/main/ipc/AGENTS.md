# IPC Directory Rules

本目录只负责 Electron IPC 桥接层。这里的代码应保持薄、可审计，不能承载业务能力。

## 职责边界

- 允许：注册/移除 `ipcMain.handle`、接收 renderer 参数、做最小输入校验、调用 main 侧业务服务、返回结果。
- 允许：定义仅服务于 IPC 注册的 channel 常量和很小的参数 guard。
- 不允许：在本目录实现业务策略、状态机、事件映射、资源扫描、配置迁移、配置持久化、窗口生命周期编排或复杂数据转换。
- 不允许：为了复用 IPC handler 内部逻辑，从其他业务模块反向 import `main/ipc/*`。

## 放置规则

- 业务服务放到对应领域目录，例如 `src/main/pet/*`、`src/main/notifications/*`、`src/main/plugins/*`。
- 纯策略/映射逻辑放到领域目录中的独立模块，并优先设计为纯函数，方便测试。
- IPC 文件只依赖业务服务，不让业务服务依赖 IPC 文件。
- 如果某个 IPC 文件开始同时处理注册、持久化、窗口控制、策略判断等多类职责，先拆分再继续新增功能。

## 设计要求

- 使用声明式表、策略对象或小型 resolver 管理可增长的分支逻辑；避免在 IPC handler 中堆叠长 `if`/`switch`。
- 对外行为保持在 preload/shared 类型中定义；IPC 层不要私自扩展隐式协议。
- 同一类 channel 的校验逻辑可以留在 IPC 层，但校验通过后的动作应交给业务服务。
- 新增业务能力时先确认模块边界：IPC 是入口，业务模块才是能力所有者。

## 示例

- 好：`ipc/pet.ts` 校验 `actionId` 后调用 `setDesktopPetActionFromUser(actionId)`。
- 差：`ipc/pet.ts` 自己读取配置、拼媒体路径、决定动作策略并直接操作窗口。
- 好：`ipc/session.ts` 收到 runtime event 后调用 `main/pet/session-event-action-policy.ts` 的映射函数。
- 差：在 `ipc/session.ts` 或 `ipc/pet-event-mapper.ts` 内维护 session 事件到桌宠动作的业务规则。
