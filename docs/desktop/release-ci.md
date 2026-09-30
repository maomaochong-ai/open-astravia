# 发版下载与失败恢复

实现入口：[desktop-release.yml](../../.github/workflows/desktop-release.yml)。

## 各平台构建完即发布安装包，更新清单由开发者上线

流水线只有 `prepare` → `quality` → `build <platform>` 三段。每个平台构建成功后在同一个任务里：

1. 校验更新清单与安装包（`verify-update-artifacts`，macOS 含签名与公证）；Windows 的校验会真实安装一遍，发版跳过。
2. 上传 Actions 制品 `desktop-<platform>`（安装包、blockmap 与 `latest*.yml`，保留 30 天）。
3. R2 目标：安装包与 blockmap 上传到 `<prefix>/`（如 `desktop/stable/`），更新清单只上传到
   `<prefix>/pending/<版本>/`。安装包按版本命名、不会被已安装的客户端读到，所以可以先传。
4. 非 test 渠道：第一个完成的平台创建 GitHub Release（正文取发布说明），其余平台追加安装包与 blockmap；
   不上传 `latest*.yml`。

因此不再等四个平台全部完成才开始发布，Release 页面会随各平台完成逐步补齐。代价是：

- **CI 不会让任何客户端看到新版本。** R2 客户端要等你把清单放到 `<prefix>/` 下；
  以 GitHub Release 为更新源的开源版要等你把清单上传到 Release。
- Release 刚创建时只有先完成的平台的安装包。

### 手动上线更新清单

1. 等需要的平台都构建完成，从 R2 的 `<prefix>/pending/<版本>/` 或 Actions 制品取回 `latest*.yml`。
2. macOS 两个架构各有一份 `latest-mac-arm64.yml`、`latest-mac-x64.yml`，放进 `apps/desktop/release/` 后
   执行 `bun run --cwd apps/desktop merge:updates:mac` 合并成 `latest-mac.yml`（只需要清单，不需要安装包）。
3. 把 `latest.yml`、`latest-mac.yml`、`latest-linux.yml` 复制到 `<prefix>/`（GitHub 目标则上传到 Release）。
   先确认清单里的版本不低于线上版本，清单引用的安装包都已在同一目录。
4. 可用 `VETTA_UPDATE_PROVIDER=generic VETTA_UPDATE_URL=<url> VETTA_DESKTOP_RELEASE_VERSION=<版本> node apps/desktop/scripts/verify-update-feed.mjs`
   检查线上清单及其引用的安装包是否可访问。

## 哪一步失败，就重跑哪一步

在原来的 Actions 运行页面选择 **Re-run jobs → Re-run failed jobs**，不要重新 Run workflow，
也不要为重试删除或重推 tag。修复源码需要新提交和新的运行；重跑旧运行仍使用原来的提交和工作流定义。

| 失败位置 | 重跑时执行什么 |
| --- | --- |
| `quality` | 重新检查；通过后开始构建 |
| `build <platform>` | 重做该平台的构建与上传；已经成功的平台不重打 |

构建矩阵关闭 fail-fast，一个平台失败不影响其他平台发布。重跑时 R2 上内容相同的安装包会跳过，
内容不同则拒绝覆盖；pending 清单与 GitHub Release 的同名文件直接覆盖。
单个平台内部的编译和各安装格式生成是一个构建任务，尚不支持单个安装格式续做。

发布流水线不单独跑平台验收（安装包实装、Windows 补充格式解包、packaged E2E）：
那一段要把未压缩的应用连同安装包一起存成 1 GB 以上的检查点再下载回来，
成本远高于它拦下的问题。packaged E2E 由 PR 上的 `desktop-packaged` 覆盖。

## 下载：不使用 Actions 缓存

发版流水线不恢复也不保存任何 Actions 缓存，每次直接从源头下载：

- Bun 包由共享安装 action 执行 `bun install --frozen-lockfile`；首次失败先保留本次已下载的内容重试，连续失败才清理 Bun 缓存兜底。
- Electron 与 electron-builder 的工具由打包器按需下载。
- 内置 Node/Python 归档、OCR 与语音模型由 `prepare:desktop-pack` 在打包时下载；运行时归档下载后检查可读性，语音模型保留 SHA-256 校验。
- Go 工具链由 `actions/setup-go` 安装，关闭其内置的模块缓存。

曾经的下载缓存（ADR-0120）在 Windows 和 macOS 上得不偿失：约 700 MB 的 Bun 缓存下载只要几秒，
解压却要 2.5～4 分钟，而直接安装只需半分钟左右；默认分支预热还额外占用四种 runner。

Windows 命令沙盒不在本仓库编译：`openvetta/codex` 的 `vetta/windows-sandbox` 分支由
`vetta-windows-sandbox` 工作流测试、编译并在推送 `vetta-sandbox-v*` tag 时发布 Release。
[prepare-windows-sandbox](../../.github/actions/prepare-windows-sandbox/action.yml) 只下载固定 tag 的压缩包，
校验压缩包 SHA-256、manifest 中的源码提交与各二进制哈希，再运行能力探测。升级沙盒时先在
`openvetta/codex` 打新 tag，再同时更新 action 里的 tag、源码提交和压缩包 SHA-256。

正式 workspace 构建继续 `--force`，不启用 Turbo Remote Cache，不跨版本复用签名产物。

GitHub 说明：[重跑工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)。
