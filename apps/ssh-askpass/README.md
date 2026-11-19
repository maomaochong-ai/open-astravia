# astravia-ssh-askpass

Windows 上的 SSH askpass 助手，一个 Go 静态编译的 PE 可执行文件。

## 为什么存在

OpenSSH 在需要口令、私钥密码、2FA 或首次主机指纹确认时，不读重定向的 stdin，
而是启动 `SSH_ASKPASS` 指向的程序。macOS/Linux 上 Astravia 运行时生成一个 `.sh`
包装脚本（`apps/desktop/src/main/ssh/askpass-assets.ts`），用它调 Electron 主程序
去连回传通道。

Windows 的 OpenSSH 用 `CreateProcessW` 直接启动 `SSH_ASKPASS`，`.sh` 不是 PE 文件，
于是报 `CreateProcessW failed error:193`（`ERROR_BAD_EXE_FORMAT`）。这个程序就是那个
能被 `CreateProcessW` 启动的真正 `.exe` 版本，做的是同一件事：读提示、连回传通道、
打印用户答案。

## 协议

与 macOS/Linux 的 `askpass-entry.cjs` 一致：

- 环境变量 `ASTRAVIA_ASKPASS_SOCKET`：回传通道地址（Windows 上是 `127.0.0.1:<port>`）。
- 环境变量 `ASTRAVIA_ASKPASS_TOKEN`：32 字节随机 token，第二道鉴权。
- 环境变量 `ASTRAVIA_ASKPASS_HOST`：发起连接的主机 id。
- 环境变量 `SSH_ASKPASS_PROMPT`：OpenSSH 8.4+ 给的提示类型。
- argv[1]：OpenSSH 传入的提示文本。
- 回传：`net.Dial("tcp", address)`，发一行 JSON `{token,hostId,prompt,promptEnv,round}`，
  读一行 JSON `{ok,value}`，`ok` 时把 `value` 打印到 stdout、退出码 0，否则退出 1。
- `round` 是父进程 pid（`os.Getppid()`），用于区分同一轮认证的第二次追问与下一次连接。

拿不到通道时必须以非零退出——若静默成功，确认类提示会退化成「默认同意」。

## 构建

```sh
make cross-build   # 产出 dist/windows-amd64/astravia-ssh-askpass.exe
```

desktop 打包脚本在 Windows 目标下把该 exe 收进 `resources/askpass/`，
`resolveAskpassWindowsBinary` 按「打包资源路径 → dev 构建产物」的顺序解析。

## 限制

只有 Windows 目标被分发。未装 Go 工具链的环境无法本地重建该 exe，但 macOS/Linux
开发态走 `.sh` 路径，不依赖它。
