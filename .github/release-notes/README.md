# 发布说明（Release Notes）

每个桌面端版本一个文件，命名为 `v<major>.<minor>.<patch>.md`，例如 `v0.5.58.md`。
`desktop-release` 工作流发布 GitHub Release 时，直接把对应文件作为 Release 正文，
所以这里写的就是用户在 Release 页面读到的内容。

## 什么时候写

新增功能、修复缺陷、合并 PR、关闭 issue 之后，把对应条目补进**当前开发中版本**的文件里
（版本号以 `apps/desktop/package.json` 的 `version` 为准）。文件不存在就新建。
发布流水线会校验该文件存在，缺失即发版失败。

## 怎么写

- 标题用 `# Vetta <版本号>`，下一行写发布日期。
- 分 `## 新增` / `## 改进` / `## 修复` / `## 其他` 四节，没有内容的小节直接省略。
- 面向用户描述影响：说清楚用户会看到什么变化，而不是改了哪个函数。行为有取舍时把代价一并写出来。
- 关联 PR 或 issue 时统一用 `owner/repo#123` 格式，例如 `openvetta/open-vetta#8`。
- 已发布版本的文件不再修改；发现写错另起一条修订说明。

历史版本（0.5.48 及更早）的记录留在 `apps/desktop/CHANGELOG.md`。
