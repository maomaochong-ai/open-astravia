---
status: accepted
---

# 面向普通用户内置可移植运行时 + bash 源重定向：以 python-build-standalone 内置而非赌公共镜像

desktop 的 agent 能力大量依赖 Node / Python 运行时与三方包（npm / pip），但目标用户是**没有开发环境的普通用户**：机器上没装 node/python，且网络只能直连国内公共镜像、**官方源（nodejs.org / pypi.org / registry.npmjs.org / github.com）不可达，也没有代理**。直觉方案是「在系统设置加个面板让用户点击下载运行时，再在 bash 执行时注入环境变量把包源指向国内镜像」。本 ADR 记录把这个直觉收敛成的具体架构，以及其中最难逆、最反直觉的一环：**Python 必须随安装包内置 python-build-standalone,而不能依赖任何公共镜像**。

## 决定

引入 [[环境管理]] 面板与 [[托管运行时]]（v1 = Node + Python），按 [[运行时来源三层]] 获取，bash 执行时做 [[源重定向]]。

- **范围**：只做运行时本体 + 包管理器源重定向，**明确不碰原生编译工具链**（gcc/make/MSVC）。
- **来源三层**：① 内置 vendor（随安装包打入当前平台二进制，首启本地拷贝进 `~/.vetta/runtimes`，零下载秒级可用，是普通用户主路径）；② 下载源列表（`urlTemplate + priority` 有序回退，仅用于升级 / 装非内置版本）；③ 系统探测（扫已有 node/python，仅作展示与兜底）。
- **优先托管版**：PATH 永远把托管运行时前置，盖过系统版——目标用户多半没有系统运行时，「碰巧有」的复用会让 agent 行为不可预测。
- **面板定位**：获取是自动的（内置 + 首启拷贝 + 自动注入），面板只负责可见性 / 升级 / 装非默认版本。普通用户 happy path 上无需打开。
- **注入机制**：[[源重定向]] 由 desktop 在 Electron main 启动时（seed 完运行时后）**一次性改全局 `process.env`**——桌面会话（in-process bash 走 `getShellEnv()` spread main env）与 IM 链路（im-gateway sidecar 继承 main env → coding-agent → bash）两条链全部自动继承。coding-agent 保持 portable、对此无感（延续 ADR-0009「宿主注入不猜环境」纪律）。注入项：`PATH` 前置、`npm_config_registry`（npmmirror）、`npm_config_prefix`（私有全局目录,与运行时版本解耦）、`npm_config_cache`、`PIP_INDEX_URL`（清华）、`PIP_TRUSTED_HOST`。
- **版本管理**：单一 recommended 版本，面板可升级；不做多版本并存。

## 关键取舍

**为何 Python 必须内置 python-build-standalone,而非赌公共镜像 / Miniconda。** 这是全案最关键、也最反直觉的决策,经实证而非推断:
- python.org 官方对 mac/Linux **不提供「解压即用」二进制**。实测清华镜像 `mirrors.tuna.tsinghua.edu.cn/python/`:`Python-3.10.12.tgz` 解压是一棵 327 个 `.c` + `configure` 的**纯 C 源码树**(要现场编译,普通用户无工具链 → 死);`3.9.7` 的 macOS `.pkg` 实测 `relocatable="false"` + `install-location=/Library/Frameworks` + `auth="root"`(要管理员、装系统目录、不可重定位 → 不符合「免权限拷进 ~/.vetta」);Windows embed zip 虽解压即跑但**无 pip/无 venv**(装不了三方包,而装包正是本需求出发点);Linux 全程只有源码。
- python-build-standalone(astral-sh)是全网**唯一**「全平台 + 可重定位 + 自带 pip/venv + 免编译免权限」的 CPython 发行,但它**只在 GitHub releases 发布,国内无稳定公共镜像**(清华/阿里/华为云都不镜像它)。
- 故对 Python,「找个可达公共镜像」**没有稳定解**。要让普通用户真正用上 Python,只能随安装包内置(或自建 CDN)。这正是竞品(腾讯 CodeBuddy / WorkBuddy)的做法——其 `.app/Contents/Resources/vendor/python/` 内置 python-build-standalone 二进制,首启本地拷贝。Node 因有 npmmirror 这一稳定镜像本可纯下载,但为体验一致同样内置。

**为何来源做成 `urlTemplate + priority` 列表而非写死。** 源是配置项:今天 priority-0 填内置/公共镜像,将来自建 COS/CDN 只是往列表插一行、改下载路径,不重写逻辑。

**为何注入点选「启动时改全局 process.env」而非 per-session overlay。** 一处生效、桌面 + IM 两链全覆盖、最少代码;coding-agent 现有 `getShellEnv()` 本就 spread `process.env`,sidecar 本就继承 main env,故全局注入是天然总闸。代价:用户升级运行时后需重启 app 才更新 env(普通用户极低频)。per-session overlay 通道(`createSession(config.env)`)保留,未来需动态切换再启用。

**为何明确不碰编译工具链。** 那是与「下载二进制」完全不同的问题类别(无底洞),强行做会让 feature 失焦。代价是**已知局限**:pip 装带 C 扩展的包时,有 wheel 则直接装(主流包都有),仅 sdist 则会尝试现场编译 → 普通用户无工具链 → 失败。v1 接受此边界,应对策略是优先选用纯实现 / 有 wheel 的包。

## 后续若改变主意

- 自建 COS/CDN 后:把它作为下载源列表的 priority-0,内置 vendor 退为兜底或下调内置版本数以缩小安装包;
- 若安装包 +140MB/平台不可接受:可改为「Node 内置、Python 走下载(GitHub 代理兜底)」,牺牲 Python 首启可用性;
- 若需多版本并存:在面板与 `~/.vetta/runtimes/<type>/versions/<ver>/` 结构上扩展,注入点改为按 session 选版;
- 若编译工具链成为硬需求:作为独立 feature 正向加(预编译 wheel 镜像 / 内置最小工具链),而非改动本 ADR 主线。
