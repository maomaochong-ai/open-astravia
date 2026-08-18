# 托管运行时与 bash 源重定向 — 实现策略

> 面向普通用户的「下载下来就有 Node / Python 环境」。本文是**实现/运维指南**;**为什么这么设计**见 [ADR-0011](./adr/0011-bundled-portable-runtimes-and-source-redirection.md),术语见 [CONTEXT.md](../CONTEXT.md)（托管运行时 / 运行时来源三层 / 源重定向 / 环境管理）。

## 1. 解决的问题

agent 能力大量依赖 Node / Python 与 npm / pip 包,但目标用户**没有开发环境**:机器上没装 node/python,网络只能直连国内公共镜像,**官方源(nodejs.org / pypi.org / registry.npmjs.org / github.com)不可达、也没有代理**。

策略两条:
1. **内置可移植运行时**,随安装包发,首启拷到用户目录,PATH 永远优先。
2. **bash 执行时注入国内镜像源**,让 `npm i` / `pip install` 自动走 npmmirror / 清华。

明确**不碰原生编译工具链**(gcc/make/MSVC)——那是另一类无底洞。已知边界:pip 装仅 sdist 的 C 扩展包会因无工具链失败。

## 2. 三层来源模型

| 层 | 触发 | 机制 |
|---|---|---|
| ① 内置 vendor | 首启 / 当前平台 / 推荐版本 | 随安装包打入 `Resources/vendor/`,首启**零网络本地拷贝**到 `~/.vetta/runtimes/`,秒级可用——普通用户主路径 |
| ② 下载源列表 | 升级 / 装非内置版本 / 无 vendor 兜底 | `urlTemplate + priority` 有序回退;源是配置项,将来插自建 CDN 只是加一行 |
| ③ 系统探测 | 展示 / 兜底 | 扫已有 node/python,**仅供面板展示**,不参与 PATH 优先级(永远优先托管版) |

Node 有 npmmirror(稳定);Python 用 python-build-standalone,**仅 GitHub 发布、国内无稳定公共镜像**——所以 Python 几乎只能靠①内置(实测清华 `/python/` 只有源码要编译、`.pkg` 要 root 不可重定位,详见 ADR-0011)。

## 3. 关键文件地图

```
apps/desktop-app/
├── src/main/runtimes/
│   ├── manifest.json     # 单一推荐版本 + 各平台字面量文件名 + 镜像源(单一真源)
│   ├── paths.ts          # 路径/平台标识/bin 目录/vendor 解析
│   ├── types.ts          # 对外状态 + 本地 registry 形状
│   └── manager.ts        # RuntimeManager:探测/seed/下载/applyEnv/status
├── src/main/main.ts      # 启动接线:initialize() + applyEnv()(早于 IM bootstrap)
├── src/main/ipc/runtimes.ts        # vetta:runtimes:get-status / reinstall / redetect
├── src/preload/{index,api}.ts      # window.vetta.runtimes 桥接 + 类型
├── src/renderer/domains/settings/components/EnvironmentSettings.tsx  # 「环境管理」面板
└── scripts/prepare-pack.js         # 打包时 stageVendorRuntimes() + extraResources
```

落地目录:`~/.vetta/runtimes/<type>/<version>/`,npm 私有全局 `~/.vetta/runtimes/.npm-global`,缓存 `.npm-cache`,本地登记 `.cache/registry.json`。

## 4. 首启 seed 流程(`RuntimeManager.initialize`)

每个运行时:
1. `detectSystem()` —— 用**注入前的 PATH 快照**探测系统版(否则会把自己注入的托管版当成系统版),写进 registry 的 `systemDetection`(仅展示)。
2. 若托管版未就绪 → `seedFromVendor()`:`Resources/vendor/<type>/...` → 拷到 `~/.vetta/runtimes/<type>/<version>/`,写 `.vendor-version` 标记(幂等:版本一致则跳过)。**只走零网络拷贝**,下载是面板触发的次要路径,不在启动阻塞。
3. 就绪则 `recordManaged()` 登记 `source: "managed"`。

> ⚠️ macOS 图形启动的 app 拿到的是 launchd 最小 PATH,`systemDetection` 可能探不到 homebrew/nvm 装的版本——只影响面板「系统已装」栏的准确性,不影响核心行为。

## 5. env 注入(A1:全局 process.env)与两种执行模型

`applyEnv()` 在启动时**一次性 mutate Electron main 的 `process.env`**(必须早于 `getImHost().bootstrap()`):

```
PATH                = <托管node bin>:<托管python bin>:<npm全局bin>:<原PATH>   # 大小写不敏感找 PATH/Path 键
npm_config_registry = https://registry.npmmirror.com/
npm_config_prefix   = ~/.vetta/runtimes/.npm-global   # 全局包落私有目录,与版本解耦、不污染系统
npm_config_cache    = ~/.vetta/runtimes/.npm-cache
PIP_INDEX_URL       = https://pypi.tuna.tsinghua.edu.cn/simple
PIP_TRUSTED_HOST    = pypi.tuna.tsinghua.edu.cn
```

为什么一处注入能覆盖所有 bash:

- **桌面普通会话 = in-process**:`RuntimeHost.createSession` 直接 `await createAgentSession()`(无 spawn/fork),coding-agent 跑在 main 进程内。bash 工具 `getShellEnv()` 返回 `{ ...process.env, PATH }`,spread 的就是 main 这份被注入的 env。**同进程,直接可见**。
- **IM / Claw 会话 = 独立子进程**:`electron --agent-rpc` 由 im-gateway spawn。env 靠**继承**:main(已注入)→ sidecar(继承)→ Go `cmd.Env=os.Environ()+extra` → agent → bash。因 `applyEnv()` 早于 sidecar spawn,继承到的就是注入后的 env。

> `read` 等不起子进程的工具与 env 无关,只有 bash 这类 spawn 子进程的才相关。

### 作用域边界(重要)
只动 Vetta 自己进程的内存 env,**不写任何文件**(不碰 `~/.npmrc` / `pip.conf` / shell 配置),**不影响用户其他进程**(他自己开终端跑 node/npm/pip 照旧)。唯一受影响的是 **agent 替他跑的命令**:用托管版 + 国内镜像,且因 `npm_config_*`/`PIP_INDEX_URL` 环境变量**优先级高于项目 `.npmrc`/`pip.conf`**,会覆盖项目里钉的私有 registry——对普通用户是优点,对「项目有私有源的程序员」是已知取舍。未来要按项目放行,用 per-session `createSession(config.env)` 通道(A2,v1 未接)。

## 6. 构建管线(打包时远程拉,不预存源)

与 im-gateway(仓库存 Go 源码、本地交叉编译)不同:**仓库不存 node/python 任何东西**,`prepare-pack.js` 的 `stageVendorRuntimes()` 在**打包时从远程下载预编译包**(Node←npmmirror、Python←GitHub),解压进 `tmpdir/vetta-desktop-build/vendor/`,再由 electron-builder `extraResources` 收进 `Resources/vendor/`。

- 缓存:`.vendor-version` 标记,同机重复打包版本未变则跳过下载(tmpdir 清掉则重下,非持久缓存)。
- 解压:统一用系统 `tar`(Win10 1803+ 自带 bsdtar,zip/tar.gz 通吃)。
- **构建期外部依赖**:构建机必须能访问 npmmirror + GitHub。GitHub 不通则 python 这步失败 → 打包失败;逃生口 `VETTA_SKIP_VENDOR=1`(出无内置包,退化为面板手动下载)。

## 7. 多平台打包(必须分平台,二进制不通用)

node/python 是**原生平台+架构专属二进制**,不能跨平台共用。vendor **刻意只装单目标平台**(im-gateway 那种全量内置对 ~140MB/平台的运行时会让安装包膨胀到 ~700MB,不可取)。

- 默认按构建宿主:`platformTag = process.env.VETTA_VENDOR_PLATFORM || \`${process.platform}-${process.arch}\``。
- 标准做法:**CI 矩阵每平台原生打**(arm64 mac 打 mac-arm64、Windows 打 win32-x64……),各自自动拿对二进制。
- 交叉打包:设 `VETTA_VENDOR_PLATFORM`(取值同 manifest 键:`darwin-arm64` / `darwin-x64` / `linux-x64` / `linux-arm64` / `win32-x64`)+ 让 electron-builder 也指向同一目标。
- 平台不支持(如 `win32-arm64` manifest 无此项)→ 打包**直接抛错**,不出坏包。
- **当前不支持 mac universal**:python vendor 解压目录两种架构都叫 `python/` 会撞名;要支持需改成按架构分子目录 + 运行时按 `process.arch` 选。

## 8. 升级运行时版本

单一推荐版,版本钉在 `manifest.json`。升级 = **改 manifest 版本号(+ python 的 `release` + 各平台 `filename`)→ 发新 app**;用户更新后首启 seed 自然换新版。面板「重新获取」按钮只是**重铺当前钉死的版本(修复/兜底)**,不会拉到比 app 内置更新的版本。

## 9. 排障

- 查内置:`ls "<App>/Contents/Resources/vendor"`(或 Windows `resources\vendor`)。
- 查 seed:`ls ~/.vetta/runtimes` + `cat ~/.vetta/runtimes/.cache/registry.json`。
- 验内置二进制能跑:`~/.vetta/runtimes/node/<ver>/bin/node --version`。
- **验 agent 真用托管版**(决定性):在 Vetta 对话框让 agent 跑
  `which node && node --version && which python3 && echo "npm=$npm_config_registry"`,
  `which node` 指向 `~/.vetta/runtimes/...` 即端到端生效。对照:自己终端跑应仍是系统版(证明作用域隔离)。
- 出无内置包做对照:`VETTA_SKIP_VENDOR=1`。
