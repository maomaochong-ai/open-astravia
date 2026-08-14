# @vetta/runtime-desktop

Vetta Agent 的 Desktop 平台 Runtime。该包拥有 Desktop 进程级组合、生命周期和平台适配，位于宿主无关 Runtime 协议与 `desktop-app` 之间。

依赖方向：

```text
desktop-app -> runtime-desktop -> coding-agent + runtime-node
                              `-> runtime-core + runtime protocols
```

`runtime-desktop` 不得反向依赖 `desktop-app`。窗口、页面和应用级 UI 留在应用包；Runtime 所需的配置、凭证、交互和 Plugin 服务通过公开合同注入。

Desktop 组合通过 `createDesktopRuntimeHostPlatformServices` 显式提供 Node 路径、队列 sidecar 与沙箱授权服务；`runtime-core` 不感知 Electron、Node 文件系统或 OS 路径规则。当前
`coding-agent` 是 Node 产品组合，`runtime-desktop` 负责把它与 Desktop 生命周期及平台服务连接起来。
