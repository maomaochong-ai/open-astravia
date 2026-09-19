# 发版缓存与失败恢复

实现入口：[desktop-release.yml](../../.github/workflows/desktop-release.yml)、
[desktop-cache.yml](../../.github/workflows/desktop-cache.yml)。

## 哪一步失败，就重跑哪一步

在原来的 Actions 运行页面选择 **Re-run jobs → Re-run failed jobs**，不要重新 Run workflow，
也不要为重试删除或重推 tag。GitHub 会保留成功任务的结果，执行失败任务及其需要继续的下游。
修复源码需要新提交和新的运行；重跑旧运行仍使用原来的提交和工作流定义。

| 失败位置 | 重跑时执行什么 |
| --- | --- |
| `quality` | 重新检查；通过后开始构建 |
| `build <platform>` | 重做失败平台的构建；已经成功的平台不重打 |
| `verify <platform>` | 下载该平台的构建检查点，重跑安装包检查和 packaged E2E；不编译、签名或公证 |
| `publish R2` / `publish GitHub Release` | 使用验收通过的制品继续发布，不重新构建 |
| `verify published r2/github feed` | 只读取线上更新源，不重新上传或构建 |

构建矩阵和验收矩阵均关闭 fail-fast，避免一个平台失败取消其他平台。
验收矩阵等待构建矩阵全部成功；发布等待所有平台验收通过。
单个平台内部的编译和各安装格式生成仍是一个构建任务，其中失败时会重跑该平台；尚不支持单个安装格式续做。安装包、hash/blockmap、
Linux 实际安装、Windows 补充格式、macOS 签名公证检查和 packaged E2E 均保留。

构建成功后立即上传 `release-build-<platform>` 检查点，里面是 `release/` 的 tar，
保留可执行权限、符号链接、Windows 验证清单及签名校验要求。
验收成功后才上传 `desktop-<platform>`，发布任务只消费后者。
检查点和发布制品保留 30 天（仍受仓库保留策略限制），只在同一次运行内恢复，
不跨提交、版本、租户或发布配置混用。制品过期或被删除后，需要重跑相应上游构建。
显式重跑全部任务会覆盖该运行同名制品；它仍然会全量构建。

线上校验失败可能是 CDN 缓存、网络或更新源配置问题，应先查看失败 URL 与状态。
已经发布的 GitHub Release 不允许覆盖；若仅其更新源校验失败，重跑独立校验任务即可。
R2 使用可变的 channel URL；如果下一版已覆盖当前 channel，旧版本校验会按版本不匹配失败。

## 下载缓存

- Bun 包下载由共享安装 action 恢复，始终执行 `bun install --frozen-lockfile`；不缓存 `node_modules`。
  首次安装失败先保留已下载内容重试，连续失败才清理缓存兜底。
- Electron 与 electron-builder 的工具下载按 OS、架构和锁文件隔离，允许恢复同平台的旧下载目录，
  由工具按版本选择。Electron 安装脚本与打包器使用相同的显式缓存根。
- 内置 Node/Python 原始归档、OCR 和 Windows 语音模型按平台、清单及下载脚本精确匹配，
  不恢复旧资源键。运行时归档在缓存命中和下载完成时检查可读性，语音模型保留 SHA-256 校验。
- Bun 安装、资源准备成功后立即保存；后面的构建或测试失败不会丢弃它们。
  工具下载在打包失败后也尝试保存。缓存被清理或未命中时仍可正常下载并构建。

GitHub 的缓存按分支/tag 限定作用域：新 tag 不能读取另一个 tag 的缓存，但能读取默认分支缓存。
因此 `desktop-cache` 在默认分支预热四种构建机器的 Bun、Electron、运行时和模型下载，
不编译应用、不签名、不发布，也不读取发布环境秘密。
electron-builder 的附加工具在真正打包时补齐；预热缓存与完整工具缓存使用不同键，
避免仅有 Electron 的预热条目阻止后续保存。

将改动合入默认分支后，可在 **Actions → desktop-cache → Run workflow** 中选择默认分支先跑一次，
等预热完成再发新版本。当前仓库默认分支是 `main`，依赖/资源变更时自动预热；
每周一、四还会维护缓存。fork 修改默认分支后应同步调整 push 的分支过滤，
定时与手动入口仍会校验实际默认分支。第一次预热和新依赖版本仍需下载；缓存可能因配额或闲置被驱逐。

这是下载复用与恢复粒度优化。正式 workspace 构建继续 `--force`，不启用 Turbo Remote Cache，
不跨版本复用签名产物。拆分增加一次检查点上传/下载和验收 runner 启动，
换取验收失败时省去整个平台的编译、打包与公证；实际耗时需用新工作流运行数据衡量。

GitHub 说明：[重跑工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)、
[缓存作用域](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)。
