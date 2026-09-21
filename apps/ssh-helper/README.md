# vetta-ssh-helper

远程项目（ADR-0124）第二阶段的远端 helper：一个静态单文件二进制，由 Desktop 经 SSH 上传到项目所在的主机，通过该 SSH 通道的 stdio 与 Desktop 通信。

没有它，远程项目照样可用——所有操作都有 `ssh exec` 的降级路径。helper 提供的是三件 `ssh exec` 做不到或做不好的事：

| 能力 | 没有 helper | 有 helper |
| --- | --- | --- |
| 后台任务（dev server、watcher） | 绑在 SSH 通道上，本机断开即结束 | 脱离连接存活，重连后可接管、续读输出 |
| 文件树刷新 | Desktop 每隔几秒把每个展开的目录整份列一遍 | 远端本地比对，有变化才推一条通知 |
| 编辑文件 | 读、写各一次往返，两次之间可能被别人改掉 | 带修订号的条件写，一次往返且不会覆盖并发修改 |

## 设计约束

- **零安装、无运行时依赖**：`CGO_ENABLED=0` 静态链接，不要求远端有 Node、glibc 特定版本或任何运行时。Go 模块依赖只有 `github.com/creack/pty`（纯 Go、无 cgo），它负责分配伪终端——各系统的 `grantpt`/`unlockpt` ioctl 差异抄一份进仓库只是把维护成本搬了个位置。
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
| `net.listeners` | 正在 LISTEN 的 TCP 端口，供端口转发挑选。只在 Linux 上实现（读 `/proc`）；其他系统返回 `ENOSYS`，由调用方退回 `lsof` |
| `pty.open` `pty.write` `pty.resize` `pty.close` `pty.list` | 交互式终端。输出走 `pty.data` 通知推送，结束推 `pty.exit` |

### pty 与 proc 的生命周期刻意相反

`proc.*` 是「无守护进程、状态全落盘」：`setsid` 脱离 SSH 会话、输出写 `output.log`，任何后续 helper 进程都能接管。那对后台任务是对的，对终端是错的：

- 终端是交互流。把它写进日志会把每个 `\r`、光标移动和全屏重绘都持久化下来——`htop` 跑几分钟就是几百 MB——而且回放不等于交互。
- 桌面端刻意**不**让终端进程跨会话保活，没有需要接管的东西。

所以一个 pty 的寿命就是打开它的那条通道：helper 退出 → 主端关闭 → 子进程收到 SIGHUP → 会话消失。重连后的 helper 报告没有任何 pty 会话，客户端据此如实告知「已断开」，而不是假装旧终端还在。

通知里的 `dropped` 是远端积压超限时丢掉的字节数：读循环永不阻塞（它和所有 `fs.*` 回复共用同一把写锁），刷屏的终端只会丢最旧的输出并如实上报。

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

没有 windows 目标。直接原因是进程托管用了 `setsid` 与进程组信号，`GOOS=windows` 编译不过；
不去补的原因是整条远程项目链路本来就是 POSIX 形状的——连上先用 `uname` 探测，每条命令外面套
`/bin/sh -c`，文件读写靠 cat / head / tail / mv / find / stat。远端用 cmd.exe 或 PowerShell 应答
SSH 时，有没有 helper 都会卡在第一步探测，也就没有可降级的余地。（远端 SSH 的 shell 若是 WSL，
它自报 `Linux`，走的就是普通 Linux 主机那条路。）

## 在真机上验证

仓库里的自动化测试都跑在回环夹具上（假 ssh 脚本把命令交给本机 `/bin/sh`），证明不了真实
sshd、真实网络和目标机器的内核与 shell。对着一台真机跑这个：

```bash
make cross-build
scripts/verify-on-host.sh user@host                    # 复用 ~/.ssh/config 的别名也行
scripts/verify-on-host.sh build-01 -p 2222 -i ~/.ssh/id_ed25519
```

它按 Vetta 自己的方式部署（同样的目录、权限与 sha256 校验），然后依次验证：握手、写入保留
权限位、以及**断开连接后后台任务是否仍在运行**——最后这条是 helper 存在的全部理由，每一步都
用一条全新的 SSH 连接发起。全绿就说明这台主机可以作为远程项目使用。

手工调协议时逐行敲 JSON：

```bash
go run ./cmd/vetta-ssh-helper serve
```
