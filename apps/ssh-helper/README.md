# vetta-ssh-helper

远程项目（ADR-0124）第二阶段的远端 helper：一个静态单文件二进制，由 Desktop 经 SSH 上传到项目所在的主机，通过该 SSH 通道的 stdio 与 Desktop 通信。

没有它，远程项目照样可用——所有操作都有 `ssh exec` 的降级路径。helper 提供的是三件 `ssh exec` 做不到或做不好的事：

| 能力 | 没有 helper | 有 helper |
| --- | --- | --- |
| 后台任务（dev server、watcher） | 绑在 SSH 通道上，本机断开即结束 | 脱离连接存活，重连后可接管、续读输出 |
| 文件树刷新 | Desktop 每隔几秒把每个展开的目录整份列一遍 | 远端本地比对，有变化才推一条通知 |
| 编辑文件 | 读、写各一次往返，两次之间可能被别人改掉 | 带修订号的条件写，一次往返且不会覆盖并发修改 |

## 设计约束

- **零依赖、零安装**：只用 Go 标准库，`CGO_ENABLED=0` 静态链接，不要求远端有 Node、glibc 特定版本或任何运行时。
- **不监听端口、不提权**：以登录用户身份运行，只经 stdio 通信。
- **没有守护进程**：后台任务的全部状态落在 `~/.cache/vetta/helper/state/tasks/<id>/`（`meta.json`、`output.log`、`exit`）。任何一次之后启动的 helper 进程都能据此列出、续读、终止任务。守护进程会多出一个会崩溃的东西、一个要保护的 socket，以及守护进程与新客户端之间的版本偏差问题。
- **任务状态固定三态** `live` / `exited` / `unverifiable`：判定 `exited` 必须有 `exit` 文件这一正面证据；进程不见了又没有 `exit` 文件（主机重启、被外部杀掉）是 `unverifiable`，不并入任何一侧。
- **协议版本是语义化版本号，不是构建哈希**（`internal/protocol`）。安装目录按它命名；按构建哈希命名会让每次应用升级后的新客户端连不上旧版本留下的任务。

## 协议

行分隔 JSON。请求 `{id, method, params}`，响应 `{id, result | error}`，通知 `{method, params}`（无 `id`）。二进制内容一律 base64，一帧里不会出现裸换行。客户端必须忽略不认识的通知；helper 对不认识的方法返回 `ENOSYS`。

| 方法 | 说明 |
| --- | --- |
| `hello` | 握手：协议版本、平台、家目录 |
| `fs.stat` `fs.readDir` `fs.readFile` `fs.realPath` `fs.listRecursive` | 读。`stat` 对不存在的路径返回 `entry: null`，不是错误 |
| `fs.writeFile` | 原子写，保留权限位、穿透符号链接；`expectedRevision` 不符时返回 `ECONFLICT` |
| `fs.mkdir` `fs.rename` `fs.remove` `fs.createEntry` | 写。`createEntry` 从不覆盖（`EEXIST`） |
| `watch.subscribe` `watch.unsubscribe` | 订阅目录；变化时推送 `watch.changed` |
| `proc.spawn` `proc.status` `proc.list` `proc.read` `proc.kill` `proc.remove` | 后台任务。`proc.read` 支持 `waitMs` 长轮询 |

错误码：`ENOENT`、`EEXIST`、`EINVAL`、`ECONFLICT`、`ENOSYS`、`EIO`。

## 开发

```bash
make build        # 本机平台 → bin/
make smoke        # 构建后握手一次，确认产物能应答
make test         # go test -race -count=1
make vet
make lint         # 需要 golangci-lint：brew install golangci-lint
make tidy
make cross-build  # 四个远端平台 → dist/<os>-<arch>/vetta-ssh-helper
make clean        # 清 bin/；dist/ 用 make dist-clean
```

根目录的 `bun run check` 不覆盖 Go；改动本目录后请运行 `make vet test`。

`cross-build` 的产物是给**开发态**用的：Desktop 会按 `dist/<os>-<arch>/vetta-ssh-helper`
这个布局找 helper（也可以用 `VETTA_SSH_HELPER_DIR` 指向别处）。安装包里的那份由
`apps/desktop/scripts/prepare-pack.js` 自己交叉编译，不走本 Makefile——改目标平台列表时
两处要一起改。

没有 windows 目标：进程托管用了 `setsid` 与进程组信号，Windows 上这些 syscall 不存在，
`GOOS=windows` 直接编译不过；远端是 Windows 时 Desktop 会降级到 `ssh exec`。

手工调协议时逐行敲 JSON：

```bash
go run ./cmd/vetta-ssh-helper serve
```
