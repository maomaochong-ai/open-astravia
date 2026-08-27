# Turborepo Remote Cache 启用清单

Remote Cache 当前保持关闭。仓库侧已经完成以下前置条件：

- build 使用 strict environment mode，并按普通包、Docs、Desktop 分别收窄输出相关变量；
- 根 `tsconfig.base.json`、根 `.env*`、workspace lockfile 与内部任务图参与哈希；
- Desktop 完整 build 保持 `cache: false`；
- build 输入排除不影响输出的包根测试与说明文件，同时为 plugin-workbench 声明根 `docs/plugin/**` 跨 workspace 输入；
- `remoteCache.signature` 已开启，未来上传和恢复制品必须提供 `TURBO_REMOTE_CACHE_SIGNATURE_KEY`；
- 本地和 CI 生成 run summary，三平台 CI 将 summary 保留 7 天用于比较命中率和耗时。

以下条件依赖实际 Remote Cache 服务和 CI secret，不能只靠仓库配置证明。全部完成前不得把
`remoteCache.enabled` 改为 `true`：

1. 选定托管或自建 Remote Cache endpoint，确认访问控制、保留周期、删除能力和不可用时的回退行为。
2. 在 CI secret 中配置 cache token/team 与独立的 `TURBO_REMOTE_CACHE_SIGNATURE_KEY`；不得把这些值写入
   task `env`、日志、summary、测试 fixture 或仓库文件。
3. 用隔离的试验分支在 Ubuntu、macOS、Windows 各执行两次普通包、CLI 和插件 build，确认第二次命中来自
   预期 cache，并检查恢复产物与本地强制重建产物一致。
4. 明确跨平台策略：只有验证为平台无关的声明和 JavaScript 制品可以共享；任何平台相关输出必须增加平台哈希
   维度、拆分 cache namespace，或继续设为 `cache: false`。
5. 审查上传的 task logs 与 run summaries，确认没有 Token、Cookie、用户路径中的私有数据或构建期秘密。
6. 模拟 endpoint 超时、无效签名和服务不可用，确认 Turbo 回退为本地执行且不会恢复未验证制品。
7. 记录三平台的命中率、恢复耗时、上传体积和总 CI 时间。只有收益稳定大于网络与制品恢复成本时才正式启用。
8. 更新 ADR-0079 的 Remote Cache 决策、`.github/workflows` 的 secret 接线和故障回退说明，再把
   `remoteCache.enabled` 改为 `true`。

试验应从纯 tsgo 包开始，再扩展到 CLI 和 Vite 插件；Desktop、模型下载、Preset staging、Electron 打包、Go 与
Kotlin 生命周期不进入首批 Remote Cache 范围。
