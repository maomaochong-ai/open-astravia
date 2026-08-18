# 主题自有数据存储

主题可以在用户本地持久化**自己的**小型 JSON 数据（进度、偏好、页面状态），但不能直接访问 `localStorage`、`window.vetta` 或文件系统。

能力通过 `ThemeHost.storage` 注入，主题只使用 SDK facade。

## 边界

主题可以：

- 通过 `useThemeStorage()` / `useThemeStorageValue()` 读写当前主题的 KV 数据。
- 存储 JSON 可序列化值（`null` / boolean / number / string / array / plain object）。

主题不可以：

- 指定其他 `themeId` 读写别人的数据（host 绑定当前 `ThemeProvider` 的 `meta.id`）。
- 存储函数、`undefined`、循环引用、二进制大文件。
- 直接调用 `window.vetta.themes.storage`（该 API 仅供 host 实现使用）。

## SDK 用法

```ts
import { useThemeStorage, useThemeStorageValue } from "@vetta/theme-sdk/storage";

const DEFAULT_PROGRESS = { unlocked: ["qi-refining"] as string[] };

function SanctumPage() {
  const [progress, setProgress, { status }] = useThemeStorageValue(
    "sanctum.progress",
    DEFAULT_PROGRESS,
  );

  // status: "loading" | "ready" | "error"
  // 对象 defaultValue 请用模块级常量，避免每次 render 新建引用

  const unlock = (id: string) => {
    setProgress((prev) =>
      prev.unlocked.includes(id)
        ? prev
        : { unlocked: [...prev.unlocked, id] },
    );
  };

  const storage = useThemeStorage();
  // storage.get / set / remove / clear / themeId / status
}
```

## Host 与落盘

| 层级 | 职责 |
|------|------|
| `@vetta/theme-sdk/storage` | 类型与 facade hook |
| desktop `ThemeHost.storage` | 绑定 active themeId、内存缓存、乐观更新 |
| main `theme-data-store` | 校验、配额、原子写文件 |
| preload `vetta.themes.storage` | IPC 桥（仅 host 使用） |

磁盘路径：

```txt
~/.vetta/desktop-app/themes/<themeId>/data.json
```

文件形状：

```json
{
  "version": 1,
  "data": {
    "sanctum.progress": { "unlocked": ["qi-refining"] }
  }
}
```

注意：这与远程主题包安装目录 `~/.vetta/themes/` 分离，避免包资源与用户数据混放。

## 规则

| 项 | 约定 |
|----|------|
| themeId | `/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/` |
| key | `/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/` |
| 单主题体积 | 整份 `data` 序列化后 ≤ 256KB |
| 读写模型 | 内存缓存同步读；写乐观更新后异步落盘 |
| 多窗口 | main 广播 `vetta:themes:storage:changed`，各窗口缓存对齐 |
| 切换主题 | 不删除旧主题数据；切回可恢复 |
| 卸载主题包 | v1 不自动清理；后续可按 themeId 删目录 |

## 数据流

```txt
Theme component
  → useThemeStorageValue / useThemeStorage   (sdk facade)
    → ThemeHost.storage.useThemeStorage()    (desktop)
      → 内存 cache
      → window.vetta.themes.storage.*        (preload, host only)
        → main theme-data-store
          → ~/.vetta/desktop-app/themes/<id>/data.json
```

## 与应用使用情况绑定（修为 / 进度）

主题不应自己扫业务事件。应用使用聚合由 app-monitor 维护，经 host 暴露：

```ts
// Prefer the main package entry so Module Federation shares one ThemeHostContext singleton.
import { useThemeStorage, useThemeUsageStats } from "@vetta/theme-sdk";
```

`ThemeUsageStats` 来自 app-monitor 聚合（经 host IPC 读取），只含使用指标，不含用户内容。主题修为规则由主题自己定义，**不**复用设置页 fanren/classic 成就阶梯。

远程主题若直接 import `@vetta/theme-sdk/storage` 或 `/usage` 子路径，必须在主题包 MF `shared` 中声明对应 singleton（与 host `themeSharedModules` 对齐）；否则会打入第二份 SDK Context，运行时报 `ThemeHostProvider is required`。

主题可声明无 UI 的 runtime 组件做同步：

```ts
// ThemeModule
runtime: [MyCultivationRuntime]
```

desktop 在主题激活时挂载 `runtime`。xianxia 示例：

- 组件：`XianxiaCultivationRuntime`（无 UI）
- 规则：多指标合成 `score`（活跃时长、消息、回合、工具、会话、token、连续活跃天、批量/自动化、知识库、项目、长会话深度等），再按主题自有 `targetScore` 映射 15 境
- 写入 key：`cultivation`（snapshot version 2）
- 落盘：`~/.vetta/desktop-app/themes/xianxia/data.json`
- 验证：DevTools 日志 `[xianxia-cultivation] synced ...`，或直接读 data.json

## 暂不支持

- 二进制 / 大文件
- 跨主题共享存储
- 云同步 / 加密
- 宿主代管 schema 迁移（主题可在 value 内自带 `version` 字段自行迁移）
- 洞天 UI 直接消费修为存储（后续接）
