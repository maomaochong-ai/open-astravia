# ADR-0186：多会话卡顿、Windows 签名与任务栏图标一致性

## 状态

已接受。用户报告三件事，各自独立但同属「Windows 平台上的可用性」：

1. 会话变多、多个会话并发执行任务时，点应用任意位置卡顿，Windows 报「程序未响应」，偶发闪退；
2. 智能应用控制拦下安装包（「无法验证其发布者」）；
3. 任务栏图标与其它应用大小不一致，且在设置里换图标后任务栏不跟随。

## 背景与证据

### 卡顿

`ipc/session.ts` 的主线程阻塞探针（ADR-0179）持续记录 `main loop blocked { lagMs: 332–728 }`，
但没有 `phase` 标签落盘，说明阻塞点不在被标记的 IPC 处理器内部，而在共享的同步计算里。

对 `entriesToHistory` / `projectConversationDocumentHistory` 做基线测量（合成会话，
每轮 3–4 个编辑版本并夹带透明节点）：

| 条目数 | 运行时投影（改动前） | 旧版历史投影（改动前） |
| --- | --- | --- |
| 450 | 0.7 ms | 0.4 ms |
| 1 800 | 3.7 ms | 14.4 ms |
| 4 800 | 13.0 ms | 91.4 ms |

`getFullHistory` 每次调用都重算整份投影，而它会被会话切换、回合取消、编辑重发反复触发；
多会话并发时这些调用在主线程上排队，累计成「点哪都卡」。

### 签名

`prepare-pack.js` 只有 macOS 的签名/公证开关；`win` 段仅 `target: ["dir"]` + 图标。
`build-inno-installer.mjs` 编译安装包后直接生成 blockmap 与 `latest.yml`，没有签名步骤。
产物 `Get-AuthenticodeSignature` 为 `NotSigned`，与用户看到的拦截一致。

### 任务栏图标

任务栏**固定项**与桌面快捷方式读的是快捷方式自身的 `IconLocation`，它只接受
`.ico/.exe/.dll`；`BrowserWindow.setIcon` 只影响运行中的窗口按钮。exe 内嵌图标在签名后
不能再改（会作废签名），因此「设置里换图标 → 固定项跟随」无法靠 exe 实现。

## 决策

### 1. 历史投影改为索引驱动（不降并发）

两条投影路径（`packages/coding-agent` 的旧版 JSONL 读取、`packages/runtime-core` 的实时文档）
都改为：一次遍历建立「用户消息 → 编辑分支父节点」的映射（带链压缩），按父节点分桶；
单条用户消息只需一次哈希查找，祖先判定只在同桶内进行。

- **不做**：不给 `getFullHistory` 加缓存。缓存会引入「文档被原地修改但缓存没失效」的
  正确性风险，而线性化已经把单次成本从 91 ms 降到 9 ms，不必再冒这个险。
- **不做**：不降低并发上限、不把会话历史改成异步线程池。用户明确要求不牺牲并发。

结果：4 800 条目下运行时投影 13.0 → 2.6 ms（5.0×），旧版投影 91.4 → 9.3 ms（9.8×）。

### 2. Windows Authenticode 签名进入打包链

新增 `windows-signing-config.mjs` + `windows-sign.mjs`：

- 凭据来自 `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`（路径或 base64 PFX），或证书存储指纹
  `ASTRAVIA_WINDOWS_SIGN_SHA1`；`CSC_LINK` / `CSC_KEY_PASSWORD` 兼容 macOS 的写法；
- **半配置直接报错**，不把「只配了密码」当成未签名放过去；
- 默认**免签名可用**：没配凭据就产出未签名包，CI 只给一条 warning；
  只有显式设 `ASTRAVIA_REQUIRE_WINDOWS_SIGNATURE=1` 时才把缺凭据当失败（对外正式渠道）；
- 默认带 RFC 3161 时间戳（`http://timestamp.digicert.com`），否则证书过期后签名一起失效。

签名位置固定为「所有 PE 写入之后」：`afterPack` 里先构启动器、搬版本目录、写图标，最后签
两个 `Astravia.exe`；Inno 出来后签安装包，再生成 blockmap 与 `latest.yml`（否则自动更新校验失败）。

### 3. 任务栏图标：构建期产出 per-id `.ico`，运行期改写快捷方式

- 构建期：`build-app-icon-icos.mjs` 把 `build/app-icons/<id>-win.png` 转成
  `build/app-icon-icos/<id>.ico`（与 `build/icon.ico` 同构），并纳入打包资源过滤；
- 运行期：换图标时把选中 ico 复制到稳定的 `<userData>/app-icon.ico`，改写指向
  `Astravia.exe` 的固定项 / 桌面快捷方式的 `IconLocation`，再通知资源管理器刷新图标缓存；
- 只改目标 exe 名为 `Astravia.exe` 的快捷方式，不碰同目录其它应用。

同时把三套取景按平台拆开（`-win` 贴满画布、`-mac` 留 8.6% 边距、无后缀 Linux），
修复「图标比邻居小一圈」。

## 备选方案

- **只加 V8 堆上限 / 只降并发**：治标且违背用户约束。
- **给 `getFullHistory` 加内存缓存**：省 CPU，但引入失效风险；线性化收益已足够。
- **用 `setIcon` 实现固定项跟随**：Windows 不支持，固定项只认快捷方式图标。
- **换图标时重写 exe 内嵌图标**：会让已签名的 exe 失效，方向错误。
- **只签 exe 不签安装包**：用户双击的是安装包，Smart App Control 拦的就是它。

## 后果

- 正面：长会话切换不再产生 90 ms 级主线程阻塞；发布产物可签名、可声明发布者；任务栏图标
  尺寸与跟随行为符合 Windows 惯例。
- 代价：Windows 构建多一步签名（需要证书或在 CI 配置 secret）；`build/app-icon-icos/` 让安装包
  多约 1 MB；每次换图标会跑一次 PowerShell（约 200–500 ms，用户主动操作）。
- 已知限制：新证书仍有 SmartScreen 信誉积累期，EV 证书才能即时消除提示；
  `osslsigncode` 不支持原地覆盖，签名时先写 `.signed` 再替换。

## 验证

- 投影：`history-projection-branch.test.ts` 固定「透明节点后的并列版本」「后代不算并列」
  「无 allEntries 时不带分支元数据」三类语义；`packages/runtime-core` 全量 465 条测试通过。
- 签名：`windows-signing.node-test.mjs` 覆盖配置校验（半配置报错、require 模式）、
  `signtool`/`osslsigncode` 参数形状、签名后必须验证、未配置时不执行。
- 图标：`windows-shortcuts.test.ts` 覆盖只改本应用快捷方式、路径转义、缓存刷新条件；
  `app-icon.test.ts` 覆盖平台后缀映射。
- 未覆盖：真实证书签名（需要私钥）与真实任务栏像素确认（需要人工看屏幕）。
