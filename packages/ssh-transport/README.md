# @vetta/ssh-transport

远程项目的 SSH 传输层：主机模型、连接复用、远端命令执行与文件操作。

架构决策见 [ADR-0120](../../docs/adr/0120-ssh-remote-projects-and-execution-boundary.md)。

## 边界

本包**只**负责「把一条命令或一次文件读写送到远端并把结果带回来」。它不知道项目、
会话、Agent 或 Electron 的存在，也不做任何本地文件 I/O。

## 关键约定

### 项目标识是带 scheme 的 URI

远程项目的 cwd 是 `ssh://<hostId>/<绝对路径>`。Desktop 把 cwd 字符串当作项目与会话的
主键（会话分片目录、活动标签 keying、侧边栏展开集合），用 URI 能让这些地方原样工作，
只有真正做 I/O 的边界才需要 `parseProjectLocation`。

解析不使用 `new URL()`——它会百分号编码路径，同一个远端路径在「用户输入」与「往返
一次之后」会得到两个字符串，主键随之分裂。

### 失败分三类，不许合并

| 错误 | verdict | 含义 |
| --- | --- | --- |
| `SshTransportError` | `unverifiable` | 连接层失败，没拿到任何远端答复 |
| `SshOperationAbortedError` | `unverifiable` | 取消或超时，远端可能已执行完 |
| `SshRemoteCommandError` | `exited` | 远端确实执行了并返回非零 |

把传输故障当成「远端说没有」的后果是具体的：网络抖一下，文件树显示目录为空，Agent
以为文件不存在并重新创建一遍。

`RemoteProjectNotSupportedError` 用于让「静默回退到本地」变成可见崩溃——本机很可能
存在同名路径，本地执行会对着完全不同的仓库给出看起来成功的答案。

### 命令构造集中在一处

`remote-command.ts` 是整条链路上唯一允许拼接命令字符串的地方。路径来自用户选择的
目录、模型给出的参数和远端目录列表，任何一处漏引号都是一次任意命令执行。

两层引用要分开理解：`buildRemoteScript` 产出交给登录 shell 的脚本，
`buildRemoteCommand` 再把整段脚本作为 `-c` 的单个参数引用一次。

### 用户命令走登录 shell，内部操作不走

`exec()` 用 `$SHELL -l -c`，因为 nvm、pyenv、asdf 只在 `~/.profile` 里改 PATH，
非交互 shell 读不到，远端明明装了 node 却报 `command not found`。

文件读写刻意不走登录 shell：profile 里任何一句 echo 都会混进 stdout，把文件内容污染成
「前面多了一行欢迎语」。读写直接走 `ssh -T` 的 8-bit clean 原始字节流，也因此不需要
base64（GNU 的 `-d` 与 BSD 的 `-D` 不兼容）。

### 传输选系统 OpenSSH

`~/.ssh/config` 的 Include、Match、ProxyJump、ProxyCommand、IdentityAgent、FIDO 安全
密钥、GSSAPI 全部由它原生支持。用户只要 `ssh host` 能连上，Vetta 就能连上。

`StrictHostKeyChecking` 保持 OpenSSH 默认的 `ask`：首次连接和主机密钥变更必须由用户
确认，`no` 会让中间人攻击静默通过，`accept-new` 则跳过首次确认。

## 测试

命令引用、URI 往返和失败分类是本包的核心风险，各有定向测试：

```bash
node scripts/quality/run-vitest.mjs run packages/ssh-transport
```

`SshProcessRunner` 是可注入端口，因此以上全部可以在没有 SSH 服务器的情况下验证。
