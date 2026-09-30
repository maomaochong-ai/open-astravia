# 发版下载与失败恢复

实现入口：[desktop-release.yml](../../.github/workflows/desktop-release.yml)。

## 哪一步失败，就重跑哪一步

在原来的 Actions 运行页面选择 **Re-run jobs → Re-run failed jobs**，不要重新 Run workflow，
也不要为重试删除或重推 tag。GitHub 会保留成功任务的结果，执行失败任务及其需要继续的下游。
修复源码需要新提交和新的运行；重跑旧运行仍使用原来的提交和工作流定义。

| 失败位置 | 重跑时执行什么 |
| --- | --- |
| `quality` | 重新检查；通过后开始构建 |
| `build <platform>` | 重做失败平台的构建；已经成功的平台不重打 |
| `publish R2` / `publish GitHub Release` | 使用已上传的平台制品继续发布，不重新构建 |
| `verify published r2/github feed` | 只读取线上更新源，不重新上传或构建 |

构建矩阵关闭 fail-fast，避免一个平台失败取消其他平台；发布等待所有平台构建成功。
单个平台内部的编译和各安装格式生成是一个构建任务，其中失败时会重跑该平台；尚不支持单个安装格式续做。

发布流水线不再单独跑平台验收（安装包实装、Windows 补充格式解包、packaged E2E）：
那一段要把未压缩的应用连同安装包一起存成 1 GB 以上的检查点再下载回来，
成本远高于它拦下的问题。packaged E2E 由 PR 上的 `desktop-packaged` 覆盖；
R2 发布前仍由 `verify-update-artifacts` 检查更新清单与 macOS 签名公证，发布后仍校验公开 feed。

每个平台构建成功后直接上传 `desktop-<platform>`（只含安装包、blockmap 与 `latest*.yml`），发布任务只消费它。
制品保留 30 天（仍受仓库保留策略限制），只在同一次运行内使用，
不跨提交、版本、租户或发布配置混用。制品过期或被删除后，需要重跑相应上游构建。
显式重跑全部任务会覆盖该运行同名制品；它仍然会全量构建。

线上校验失败可能是 CDN 缓存、网络或更新源配置问题，应先查看失败 URL 与状态。
已经发布的 GitHub Release 不允许覆盖；若仅其更新源校验失败，重跑独立校验任务即可。
R2 使用可变的 channel URL；如果下一版已覆盖当前 channel，旧版本校验会按版本不匹配失败。

## 下载：不使用 Actions 缓存

发版流水线不恢复也不保存任何 Actions 缓存，每次直接从源头下载：

- Bun 包由共享安装 action 执行 `bun install --frozen-lockfile`；首次失败先保留本次已下载的内容重试，连续失败才清理 Bun 缓存兜底。
- Electron 与 electron-builder 的工具由打包器按需下载。
- 内置 Node/Python 归档、OCR 与语音模型由 `prepare:desktop-pack` 在打包时下载；运行时归档下载后检查可读性，语音模型保留 SHA-256 校验。
- Go 工具链由 `actions/setup-go` 安装，关闭其内置的模块缓存。

曾经的下载缓存（ADR-0120）在 Windows 和 macOS 上得不偿失：约 700 MB 的 Bun 缓存下载只要几秒，
解压却要 2.5～4 分钟，而直接安装只需半分钟左右；默认分支预热还额外占用四种 runner。

正式 workspace 构建继续 `--force`，不启用 Turbo Remote Cache，不跨版本复用签名产物。

GitHub 说明：[重跑工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)。
