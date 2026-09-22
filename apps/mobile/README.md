# Vetta Mobile

Vetta 的 Expo/React Native 手机客户端（Expo SDK 57、React Native 0.86、Expo Router）。它通过 `@vetta/remote-control` v2 协议与 Vetta Desktop 配对，在手机上镜像电脑正在处理的会话：查看进度、继续追问、回答电脑上弹出的提问、中止任务。原 Kotlin Multiplatform Android 客户端位于 [`../kotlin`](../kotlin)，已冻结、不再跟进新协议。

## 技术栈

- 样式：[Uniwind](https://uniwind.dev)（Tailwind v4，Metro 插件，`global.css` 为主题事实源）
- 组件：[HeroUI Native](https://heroui.com/docs/native)（开关、底部弹层等交互骨架，视觉由 `global.css` 的主题变量覆盖）
- 图标：`lucide-react-native`，与桌面端同一套图标
- 协议、加密、配对链接与载荷合同全部来自 `@vetta/remote-control`，手机端不另写协议实现
- 状态：zustand（`src/store/app-store.ts`）；框架无关的连接与数据逻辑放在 `src/remote/`

一期保持可以在 **Expo Go** 里运行：没有开发构建专用模块。

## 开发

需要 Bun 1.3.14 与 Node.js LTS。依赖统一从仓库根目录安装，不要在子目录生成额外锁文件：

```bash
bun install
bun run --cwd packages/remote-control build   # 手机端依赖协议包的 dist
```

在仓库根目录启动 Metro：

```bash
bun run dev:mobile
```

也可以直接选择平台：

```bash
bun run --cwd apps/mobile ios
bun run --cwd apps/mobile android
bun run --cwd apps/mobile web
```

### 局域网连接的真机注意事项

- iOS 首次连接电脑的局域网地址会弹「本地网络」权限，必须允许。这个权限和明文 `ws://` 的例外都写在 `app.json` 的 `infoPlist` 里，**Expo Go 用的是 Expo Go 自己的配置**，局域网连接的最终验收要用开发构建（`bunx expo run:ios` / `bunx expo run:android`）在真机上跑。
- Mac 第一次开启手机连接时会弹防火墙提示，选「允许」。

## 配对与连接

1. 电脑端生成 `vetta://pair?...` 二维码，里面有配对 id、手机专属密钥、电脑的身份公钥、局域网地址列表和可选的中继地址。
2. 手机扫码后先试局域网地址，连不上再走中继；首次 `online` 即持久化这台电脑（`src/remote/pairing-store.ts`，密钥进系统钥匙串）。
3. 手动配对：输入 `IP:端口`，手机连 `ws://IP:端口/v2/lan/pair`（`vetta.manual` 子协议），两端显示同一个 6 位验证码，电脑上点允许后，电脑通过加密的 `device.paired` 事件把长期凭据交给手机。
4. 日常连接由 `src/remote/channel-manager.ts` 负责：局域网优先（约 1.5 s 预算，多地址并发），失败回退中继；在中继上时每 20 s 探测一次局域网并静默切回。事件序号跨通道连续，重连只补发缺失的尾部（`resumeFrom`）；桌面端发 `session.resync` 时手机整体重拉。
5. 会话列表与打开过的对话缓存在本机 SQLite（最近 50 个），电脑离线时只读展示；解除配对会连同缓存一起删除。

## 验证

```bash
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile test        # vitest，覆盖连接策略、转写归约、配对流程、缓存
bun run --cwd apps/mobile export:web  # CI 的 Web 导出冒烟；Web 不是产品目标
bun --cwd apps/mobile x expo-doctor@latest
```

Web 导出只做构建冒烟：钥匙串、SQLite 由 `*.web.ts` 内存实现替代，相机不可用。

## Codex 使用指南

请从仓库根目录启动 Codex，这样它能同时读取根 `AGENTS.md`、workspace 配置和项目级 Expo skills。

仓库已安装以下项目级 skills：

- `expo-overview`：Expo/EAS 任务入口与技术选型。
- `expo-project-structure`：新项目目录、路由、screen 与平台文件边界。
- `expo-router`：Expo Router 路由、导航、tabs、modal 和链接。

Skills 位于仓库的 `.agents/skills/`，来源和内容哈希记录在 `skills-lock.json`。新安装或更新 skill 后需要重新开启 Codex 任务，才会加载新内容。

恢复或更新项目级 skills：

```bash
npx skills@latest experimental_install
npx skills@latest update expo-overview expo-project-structure expo-router --project --yes
```
