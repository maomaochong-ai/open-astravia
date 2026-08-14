# ADR-0060：插件网络 host 声明与 official 命令执行

## 状态

Accepted（2026-08-07）

## 背景

插件的 `network.fetch` 原本只能按权限整体开关，无法看出插件准备访问哪些目标。此前增加的公网地址判断又会阻止明确需要访问 ComfyUI 等本机/私网服务的插件。命令执行即使不经过 shell，只要允许 `node`、`git` 或 `npm`，仍可间接访问完整文件系统或启动任意程序，普通第三方插件不应获得该能力。

当前插件与宿主共享 renderer，本文策略用于拦截通过公开插件 API 发起的普通越权行为，不声明为 JavaScript 强隔离边界。原生 Web API、动态模块导入和同 renderer 深度攻击属于 ADR-0023 已接受的风险。

## 决策

1. 声明 `network.fetch` 的插件必须在 `plugin.json` 同时提供非空 `network.allowedHosts`。
2. host 条目支持精确域名、精确 IPv4/IPv6、`localhost` 和最左侧子域通配符。只匹配 hostname，不限制 http(s) 端口。
3. 公网、私网、链路本地和 localhost 使用相同规则：明确声明即可访问，未声明即拒绝。
4. `*` 只对宿主判定为 `trustLevel === "official"` 的插件生效，以支持地址由用户设置或远端结果决定的内置插件。
5. capability adapter 从 session 取得插件 ID，并把它作为受 namespace constraint 保护的通用网络策略命名空间写入 foundation network 请求；renderer 不能自行指定策略主体。主进程在插件集成 Provider 中把该 namespace 解析为插件网络策略，并对首次请求和每次重定向重新校验 host，跨 host 重定向移除认证头。Capability SDK 和 Runtime 不识别 Plugin 身份或权限名称。
6. `agent.command.run`、`agent.command.spawn` 和 `commands` 只对 official 插件形成有效权限。local/community 插件在安装、注册表迁移和 dev overlay 中均不会获得这些权限，主进程 run/spawn 入口再次校验 trustLevel。
7. official 身份仍由系统安装来源产生，不能由插件 manifest 自行声明。

## 后果

- 第三方网络插件升级后必须补充 `network.allowedHosts`，否则清单解析失败。
- 声明 localhost 或私网 IP 的插件可以访问对应服务，不再受统一 SSRF 黑名单影响。
- official 插件使用 `*` 时网络范围仍然较大，但这与允许其执行命令的信任等级一致。
- 本策略不阻止插件直接使用 renderer 原生 `fetch`；若未来威胁模型升级，需要另行引入独立进程或更强运行时隔离。
