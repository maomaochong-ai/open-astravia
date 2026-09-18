# Changelog

All notable changes to `@vetta-org/capability-sdk` are documented in this file.

## [Unreleased]

### Fixed

- Preserve `reasoningLevels` and `defaultReasoningLevel` when updating model providers, including plugin-owned model catalogs, instead of silently removing them during input parsing.

## [0.1.2] — 2026-09-17

- Media Provider 协议升级到 v5：生成能力可声明模型目录与默认模型，宿主会校验显式模型并解析默认值。
- Agent 图片生成设置在 Provider 偏好之外增加文生图、图生图模型偏好；旧配置仍按 Provider 默认模型工作。

## [0.1.0] — 2026-09-14

首次发布到 npm。此前它只作为 workspace 包在仓库内被引用，但 `@vetta-org/plugin-sdk`
已经在运行时 import 它的 skill 展示 schema，发布后者必须先发布它。

### Added

- 能力契约层：稳定的能力 token、id、输入/输出类型、约束、授权、会话合同与错误码。
- 子路径导出 `./access`、`./foundation`、`./domain`。

合同本身自 `094abe091` 起在仓库内演进，未在 npm 上留下中间版本；0.1.0 即首个公开版本。
