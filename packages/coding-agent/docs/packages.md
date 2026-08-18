# Packages

把 extensions / skills / prompts 等打成可安装源（npm、git 或本地路径）。

## CLI

```bash
vetta install <source> [-l]   # -l 写入项目 settings
vetta remove <source> [-l]
vetta update [source]
vetta list
```

源格式示例：

- `npm:@scope/pkg@1.2.3`
- `git:github.com/user/repo@v1`
- 本地绝对/相对路径
- `https://github.com/user/repo`

临时试跑：`vetta -e npm:@scope/pkg`（不写 settings）。

包默认装到 `~/.vetta/agent/` 或项目 `.vetta/` 下的 npm/git 缓存；settings 的 `packages` 数组记录源。

**安全：包内扩展可执行任意代码，安装前审查。**

## 包形态

`package.json` 可声明 `pi`（历史键名）资源，或使用约定目录：`extensions/`、`skills/`、`prompts/` 等。过滤与启停字段见 `src/resources/packages/` 与 settings 中的 package 对象（`source` + 可选 `extensions`/`skills`/`prompts` 白名单）。

产品包规则实现在 `src/resources/packages/`；终端命令编排与输出由 `packages/cli-app/src/coding-agent-cli-control.ts` 承担。

资源目录中的格式解析、优先级和快照属于 Coding Agent；文件遍历、摘要、Git/NPM 命令和临时目录由宿主通过
`ResourceAccessPort`、`ResourcePackageHost` 等合同注入。不要从资源规则直接导入 `node:fs`、`node:path` 或
`@vetta/runtime-node`。
