# Vetta Mobile

Vetta 的 Expo/React Native 移动客户端，当前基于 Expo SDK 57、React Native 0.86 和 Expo Router。原 Kotlin Multiplatform Android 客户端位于 [`../kotlin`](../kotlin)，两者独立构建。

## 开发

需要 Bun 1.3.14 与 Node.js LTS。依赖统一从仓库根目录安装，不要在子目录生成额外锁文件：

```bash
bun install
```

在仓库根目录启动 Metro：

```bash
bun run dev:mobile
```

也可以直接选择平台：

```bash
bun run --cwd apps/mobile android
bun run --cwd apps/mobile ios
bun run --cwd apps/mobile web
```

主要源码在 `src/`：`src/app/` 由 Expo Router 负责路由，可复用组件、hooks 和非路由逻辑放在同级专用目录。平台差异优先使用 `.ios.tsx`、`.android.tsx` 和 `.web.tsx` 文件分离。

## 验证

```bash
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile export:web
bun --cwd apps/mobile x expo-doctor@latest
```

根目录的 `bun run check` 也会执行 Mobile 类型检查。`.github/workflows/mobile.yml` 会在 Mobile 相关文件变化时重复类型检查和 Web 导出。

## Codex 使用指南

请从仓库根目录启动 Codex，这样它能同时读取根 `AGENTS.md`、workspace 配置和项目级 Expo skills。

仓库已安装以下项目级 skills：

- `expo-overview`：Expo/EAS 任务入口与技术选型。
- `expo-project-structure`：新项目目录、路由、screen 与平台文件边界。
- `expo-router`：Expo Router 路由、导航、tabs、modal 和链接。

Skills 位于仓库的 `.agents/skills/`，来源和内容哈希记录在 `skills-lock.json`。新安装或更新 skill 后需要重新开启 Codex 任务，才会加载新内容。可以在提示词中显式指定：

```text
使用 $expo-project-structure 为 apps/mobile 新增设置功能的目录结构。
使用 $expo-router 为 apps/mobile 新增设置页和 modal 导航。
```

恢复或更新项目级 skills：

```bash
npx skills@latest experimental_install
npx skills@latest update expo-overview expo-project-structure expo-router --project --yes
```

Expo 官方 Codex 插件提供更多开发、原生 UI、升级、EAS 部署和 Codex Run actions 指导。插件属于 Codex 用户环境，不会随 Git 仓库分发；新开发者需要执行：

```bash
codex plugin add expo@openai-curated
```

安装后重启 Codex。当任务涉及 EAS Build、TestFlight、Play Store 或托管服务时，先说明要使用的 Expo/EAS 能力及可能的账户或费用影响；普通本地开发不需要 Expo 付费服务。
