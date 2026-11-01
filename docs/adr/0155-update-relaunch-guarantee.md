# ADR-0155：更新重启必须保证新版本被拉起

## 状态

已接受。三条安装通道的「重启」语义统一为「新版本一定会被拉起」；更新清单格式、安装包产物与发布链路不变。

## 背景

「点重启 → 应用没回来」在三个平台上由不同原因造成，但结果相同：进程已经退出，桌面上什么都没有，用户只能自己找图标重开。

1. **未签名 macOS 内置安装器**（ADR-0153）。安装脚本先等旧应用退出，再解包、替换 bundle、去 quarantine。任何一步失败时，脚本直接 `exit 1`：应用已经退出，替换没做完，也没有任何东西把旧版拉回来。
2. **Windows 后台更新**。`Inno` 静默安装完成后由 `app.relaunch()` 负责重启，而它只在正常 quit 流程里 spawn。退出流程被 sidecar 句柄拖住时，退出看门狗会在 8s 后 `app.exit(0)` 硬退——登记过的 relaunch 因此可能整个丢失。安装器的 `[Run]` 项带 `skipifsilent`，后台更新时也不会执行，没有第二条兜底路径。
3. **新进程的启动竞态**。`app.relaunch()` 的目标由 Electron 在 shutdown 期间 spawn，Windows 看门狗则可能更早拉起一次。此时旧进程可能还没有释放 `requestSingleInstanceLock`，新进程会走 `if (!gotSingleLock) app.exit(0)` 静默消失；启动它的父进程早已返回，桌面同样没有窗口。

Linux AppImage 不存在第 2 类问题：electron-updater 的 `AppImageUpdater.doInstall` 在 `isForceRunAfter` 下会自己 `spawn` 新目标。

## 决策

### 1. 未签名 macOS 安装器：失败也要把应用拉起来

`mac-unsigned-installer.ts` 生成的脚本新增 `relaunch_app()` 与 `abort()`：

- `relaunch_app()` 先 `open "$APP"`，失败则回退到直接执行 `Contents/MacOS` 下的主可执行文件；
- 所有失败分支改为 `abort "<reason>"`，即打印原因、调用 `relaunch_app`、再 `exit 1`；
- 成功路径同样以 `relaunch_app || abort "relaunch failed"` 收口。

唯一不拉起的失败分支是「旧进程在超时窗口内仍存活」：那种情况下拉起会得到两个实例，脚本置 `SKIP_RELAUNCH=1` 后直接退出，把重启交给用户或下一次启动。

### 2. Windows：硬退之前自己拉起新版

退出看门狗从「8s 后 `app.exit(0)`」改为「8s 后先 spawn 版本目录里的新可执行文件，再 `app.exit(0)`」，逻辑抽到 `windows-quit-watchdog.ts`：

- 拉起用 `spawn(executablePath, process.argv.slice(1), { detached: true })`，不依赖 `app.relaunch()`——硬退路径不保证它还能 spawn；
- 找不到准备好的可执行文件时记一条日志，仍然退出，不把退出流程再卡一次；
- 拉起抛错也不能阻断退出。

版本目录中的路径由 `InnoWindowsUpdateController.preparedExecutablePath()` 提供。

### 3. 单实例锁：只为「更新重启」留重试窗口

`main.ts` 在取锁前先读 `.pending-update-relaunch` 标记（ADR-0153 已写入的同一标记，只读判断，消费仍只发生在窗口就绪后），命中时用 `acquireSingleInstanceLockWithRetry` 重试取锁，最多 15s、每 250ms 一次；未命中时仍然只尝试一次，立即退出，由旧实例的 `second-instance` 去聚焦窗口。

这样第 3 类竞态被消掉，且普通二次启动的延迟没有变化。

## 备选方案

| 方案 | 代价 |
| --- | --- |
| 让 launcher（`native/windows-launcher`）承担「等旧进程退出再启动」的职责 | 更彻底，但要在 Go 侧新增等待与重试协议、把 launcher 路径登记进状态目录，且无法在本机验证 Windows 行为；当前证据不足以支撑这个改动范围 |
| 用 `cmd /c start` 做延时拉起 | 依赖中间 shell，`STARTUPINFO` 可能把隐藏标志传给子进程，正是 launcher 注释里警告过的「主窗口变 tray-only」风险 |
| 失败时弹系统通知让用户手动重开 | 把更新成本转嫁给用户，且后台静默更新时通知很容易被忽略 |
| 不重试单实例锁，改为「新进程发现锁被占就等旧实例退出」 | 与「第二个用户点图标」无法区分，会让每次重复点击都多等一个超时 |

## 后果

- 三条通道的「重启」语义一致：失败分支至少把旧版拉回来，成功路径一定出现新版本窗口。
- 硬退路径多一次 `spawn`，最坏情况是两个进程竞争同一把锁，落败的那个在 15s 内静默退出，用户看不到窗口闪动。
- 未签名 macOS 安装器失败后会出现「版本没变但应用自己打开了」，这是刻意行为：用户至少要能继续用。
- Windows 侧行为只能靠单元测试与 CI 打包 E2E 覆盖，真实机器上仍需人工复测确认。
