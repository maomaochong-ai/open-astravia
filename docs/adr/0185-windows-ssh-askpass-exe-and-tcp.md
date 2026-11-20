# ADR-0185：Windows SSH 密码认证——askpass 改走本地可执行与 TCP 回传

## 状态

已接受，已实施。Windows 上 askpass 改为 Go 编译的 `astravia-ssh-askpass.exe`，回传通道改为
TCP loopback；`resolveEnv` → `connection` → `getSshConnection` 链路随之异步化。核心验证：
ssh-transport 类型检查、desktop lint、askpass TCP 回传与二进制定位测试均通过；Windows 实机
密码认证需在下次 Windows 构建上验证。

## 背景

用户在 Windows 上用密码连接 SSH 主机时报错：

```text
Cannot reach 120.77.202.175: CreateProcessW failed error:193
ssh_askpass: posix_spawnp: Unknown error
Permission denied, please try again.   （连报三次）
```

`error:193` 即 Windows 的 `ERROR_BAD_EXE_FORMAT`——`CreateProcessW` 无法启动
`SSH_ASKPASS` 指向的程序。根因有两层，都来自「askpass 只在 macOS/Linux 上实现过」：

1. **askpass 载体是 `.sh`**：`askpass-assets.ts` 运行时生成一个 `#!/bin/sh` 脚本，
   内容是用 `ELECTRON_RUN_AS_NODE=1` 调 Electron 主程序去执行一个 `.cjs`。Windows 的
   OpenSSH 用 `CreateProcessW` 直接启动 `SSH_ASKPASS` 指向的文件，而 `.sh` 不是 PE
   可执行文件，于是 `error:193`。askpass 起不来 → 拿不到口令 → 三次 `Permission denied`。
2. **回传通道是 Unix domain socket**：`askpass-server.ts` 用 `server.listen(socketPath)`
   监听一个 unix socket，Windows 的 Node 不支持这种监听，即使 askpass 能起来也连不上主进程。

结果：Windows 上密码认证完全不可用，只有免密密钥认证能连。这与 ADR-0124 的承诺
（口令、私钥密码、2FA、指纹确认都经 askpass 接回 UI）不一致。

## 参考实现调研：codex 为何能支持

`openai/codex`（`codex-rs`）的远程执行走 `environments.toml` 里的
`program = "ssh"`（`StdioCommand`），由 `codex-utils-pty` 给 ssh 子进程分配 pty
（`local_process.rs` 里的 `tty: bool`）。因为 codex 是 CLI、本身就跑在用户终端里，
ssh 子进程能继承真实 tty，OpenSSH 的密码提示直接显示在终端，用户原地输入——**codex
完全不注入 `SSH_ASKPASS`**（全库 grep 无结果）。

这解释了 codex 为什么密码认证可用，也说明**它的方式无法照搬**：Astravia 是 Electron
桌面应用，`spawn` 出的 ssh 子进程没有 tty，OpenSSH 的密码提示（读 `/dev/tty` / conin，
不读重定向的 stdin）拿不到，只能走 `SSH_ASKPASS`。所以 Astravia 的 askpass 方向是对的，
错的是 Windows 上 askpass 的「载体」和「回传通道」两处平台假设。

## 决策

在 Windows 上补齐 askpass 的两处平台实现，macOS/Linux 路径保持不变：

1. **askpass 载体改为真正的 PE 可执行文件**：新增一个 Go 写的 `astravia-askpass.exe`
   （`apps/ssh-askpass`），复用仓库已有的 Go 工具链与静态编译先例（`apps/ssh-helper`、
   `apps/im-gateway`）。它只做一件事：读 argv 里的提示文本与环境变量里的 socket 地址、
   token、hostId，连接主进程回传通道，把答案写到 stdout，按答案退出 0/1。Windows 上
   `SSH_ASKPASS` 指向这个 exe；macOS/Linux 仍用现有 `.sh` + Electron Node 方案。

2. **回传通道在 Windows 上改用 TCP loopback**：`askpass-server.ts` 在 `win32` 上监听
   `127.0.0.1` 的随机端口（`server.listen(0, "127.0.0.1")`）而不是 unix socket，其余平台
   保持 unix socket。安全边界不变——通道仍要求 32 字节随机 token 才能应答，只是把
   「socket 文件权限 + token」换成「loopback + token」。loopback 上同机进程连得进端口，
   但拿不到 token 的进程依然无法通过校验，安全强度与 unix socket 场景等价。

3. **构建与分发**：`apps/ssh-askpass` 提供 `make cross-build`，产出
   `dist/windows-amd64/astravia-askpass.exe`；desktop 打包脚本在 Windows 目标下把该 exe
   收进 `resources/build/askpass/`。`resolveAskpassBinary` 按「打包资源路径 → dev 构建产物」
   的顺序解析，解析不到时 Windows 上退回 `undefined`（不注入 askpass），此时密码认证
   会失败并带着 ssh 自己的报错，与现在 macOS 上 askpass 准备失败的行为一致。

## 备选方案

- **Windows 上禁用 askpass、密码认证明确失败**：改动最小，但把「支持密码登录」这个
  承诺在 Windows 上直接砍掉，用户明确否决（「不是明确失败就完了，两种方式都要可用」）。
- **用 pkg / nexe 把 `.cjs` 编译成 exe**：引入新的 Node 打包依赖，与仓库「Go 静态编译
  跨平台二进制」的既有做法不一致，且 askpass 只需几十行逻辑，用 Go 更轻。
- **给 ssh 子进程分配 pty（照搬 codex）**：Electron 桌面应用没有宿主终端，pty 的
  输入输出无处可接；即便用 node-pty 伪终端，也等于把「谁在问密码」重新发明成终端
  子系统，复杂度远高于 askpass 的两个小补丁。

## 后果

- Windows 上密码、私钥密码、2FA、首次主机指纹确认全部可用，与 macOS/Linux 对齐。
- 多出一个 Go 程序与一条 Windows 构建产物，desktop 打包清单需同步维护。
- 回传通道在 Windows 上从 unix socket 变为 TCP loopback：安全上靠 token 维持，
  `askpass-server` 的 `SshAskpassChannel` 对外契约（`socketPath` / `token`）需为
  Windows 引入「地址」语义，调用方（`askpass-assets` / `askpass-runtime`）同步适配。
- 未装 Go 工具链的环境无法本地重建 askpass.exe；但该产物只随 Windows 安装包分发，
  开发态在 macOS 上仍走 `.sh` 路径，不受影响。
