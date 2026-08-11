# Vetta Plugins

本目录集中维护插件 SDK、构建工具、系统插件和外置插件示例，所有包统一纳入
仓库根 workspace。

## 开发前必读

创建、修改、构建或审查本目录中的任何内容前，必须先完整阅读并遵守
[AGENTS.md](./AGENTS.md)。依赖管理、目录结构、manifest、构建制品和验证规则
均以该文件为准。

## 目录

- `plugin-sdk/`：插件运行时 API 和类型。
- `plugin-vite/`：插件 Vite 配置与 zip 打包工具。
- `presets/`：随 Vetta Desktop 发布的系统插件。
- `externals/`：不随 App 打包的外置插件示例。

## 安装

从仓库根目录统一安装依赖：

```bash
bun install
```

## 构建系统插件

从 Desktop 包目录构建所有 Preset，并将 zip 制品解压到开发 staging：

```bash
cd packages/desktop-app
bun run build:presets
```

开发环境会先把这些插件 staging 到 `packages/desktop-app/.artifacts/system-plugins/`，
再默认为当前租户的全部 preset 建立内存 dev 链接并启动开发服务器；关闭 dev 链接时回落 staging。
Preset 不会安装到 `~/.vetta/plugins`。
