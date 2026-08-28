# Changelog

All notable changes to `@vetta/runtime-knowledge` are documented in this file.

## [Unreleased]

### Changed

- Knowledge Runtime 不再导出包含 Coding Agent `todo` 工具协议的加工指南；产品模型指令由上层 Feature 组合。

### Added

- **独立 Knowledge Runtime**：提供知识领域模型、文件存储、标签查询、并发安全写页、加工差异、批次规划、失败隔离和轮次收尾，不依赖 `coding-agent` 或 Desktop。
