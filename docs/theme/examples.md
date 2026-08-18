# 主题示例

当前有一个正式的内置主题包：

```txt
packages/themes/builtin/xianxia/
```

它提供一个 `ThemeModule`，用于验证 appearance 和组件覆盖能力。

## Xianxia

Xianxia 由 `build:themes` 独立构建为主题归档。开发环境从 `.artifacts/system-themes/xianxia` 发现，发布环境从 `Resources/system-themes/xianxia` 发现；desktop 不导入它的源码。

效果：

- 默认应用结构不变。
- `appearance.surfaces` 提供仙侠背景、图片边框和面板装饰。
- `components["app.background"]` 和 `components["chat.inputBarBackground"]` 提供主题自有装饰组件。
- 图片资源与主题源码位于同一个主题包，不依赖 desktop public 目录。

## 依赖边界

Xianxia 只依赖 `@vetta/theme-sdk` 和 `@vetta/theme-ui`。`AppBackground`、`InputBarBackground` 等应用 UI view 及其 registry contract 由 `@vetta/theme-ui` 导出。

远程主题不应 import `@shared/*`、`@domains/*` 或 desktop 内部 hook。需要数据时调用 SDK facade hook；需要复用 UI 时，把 hook 返回的 model 作为 props 传给官方 view。

## 当前约束

- 内置主题已由主进程扫描和 runtime loader 加载，但设置页 UI 主题选择尚未接入。
- 远程主题包下载和 Module Federation 加载尚未接入。
- 新增可见文案仍必须走 i18n。
