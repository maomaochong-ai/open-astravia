/**
 * 能力市场仓库的骨架。
 *
 * 手写一个合规的 hub 成本不低：`.vetta/marketplace.json` 的必填字段、目录约定、以及那几条
 * 只在别人机器上复现的发布约束，都得先读一遍文档才知道。这里把它变成一条命令。
 *
 * 仓库级 `AGENTS.md` 是关键的一半：落在仓库根的 Agent 需要知道「能力目录才是开发单位、
 * 索引由 sync 对账」，否则它会去手改 marketplace.json。
 */

export function renderHubAgentsGuide(input: { name: string }): string {
	return `# ${input.name}

Vetta 能力市场仓库。本仓库索引若干**能力**（plugin / mcp / skill / scene / bundle），
每个能力是 \`abilities/\` 下的一个自包含目录。

## 开发时站在能力目录里，不是站在这里

> 仓库根没有 \`node_modules\`，所以在根上执行时用全名 \`@vetta-org/plugin-cli\`；进了能力目录、
> \`npm install\` 之后，裸命令 \`vetta-plugin-cli\` 才在 \`node_modules/.bin\` 里。

\`\`\`bash
cd abilities/plugins/<slug>      # ← 开发单位是这个目录
npm install
npx vetta-plugin-cli docs        # 手册（随该目录装的 SDK 版本）
npm run install:vetta            # 装进正在运行的 Vetta
npx vetta-plugin-cli watch       # 热更新
\`\`\`

每个插件目录自带 \`AGENTS.md\`，里面有该读哪些手册、以及不可违反的几条。**先 \`cd\` 进去再动手**：
所有开发命令都作用于「最近的那个能力目录」，站在仓库根上它们不知道你指的是哪一个。

新建一个插件：

\`\`\`bash
npx @vetta-org/plugin-cli init --id <slug> --name "<Display Name>" abilities/plugins/<slug>
\`\`\`

它只创建目录，**不会**动索引——新能力什么时候上架是人的决定。想好了再按下面的方式登记。

## 索引由工具对账，不要手改派生字段

\`.vetta/marketplace.json\` 里能力的 \`version\`、\`config.api_version\`、\`config.permissions\`、
\`config.commands\` 全都是从能力包推导出来的。改完能力后：

\`\`\`bash
npx @vetta-org/plugin-cli sync          # 回填派生字段，并推进 marketplaceVersion
npx @vetta-org/plugin-cli sync --check  # 只报不写，非零退出（CI 用）
\`\`\`

要**手写**的只有身份与展示：\`slug\`、\`name\`、\`description\`、\`source.path\`、\`category\`、\`tags\`、
\`detail\`。新能力上架时手动加一条这样的条目，其余字段交给 \`sync\`。

三条容易踩的约束，\`sync --check\` 会替你守住：

| 约束 | 漏了会怎样 |
| --- | --- |
| 条目 \`version\` 必须 == 能力包里的版本 | 宿主同步**直接失败** |
| \`plugin.json\` 的 \`entry\` / \`styles\` 必须在已发布目录里真实存在 | 本地能装，市场上装不了 |
| 改了任何内容必须换 \`marketplaceVersion\` | 客户端不报错、也不更新，用户永远收不到 |

第三条最阴险——它不报错。

## 为什么插件目录里要提交 \`dist/\`

客户端按 \`source.path\` 直接读目录并安装，**它不会替你构建**。所以构建产物必须在仓库里。
脚手架生成的插件目录因此不忽略 \`dist/\`。

## 发布

1. 改能力 → 在能力目录里 build
2. 回仓库根 \`npx @vetta-org/plugin-cli sync\`
3. 提交并推送；客户端在 \`marketplaceVersion\` 变化时拉新快照
`;
}

export function renderHubWorkflow(): string {
	return `name: marketplace

on:
  pull_request:
  push:
    branches: [main]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # 索引与能力包漂移的后果有两种不在作者机器上复现、一种压根不报错，所以在这里拦。
      - run: npx --yes @vetta-org/plugin-cli sync --check
`;
}

export function renderHubReadme(input: { name: string; repository: string }): string {
	return `# ${input.name}

A Vetta ability marketplace. Add it in Vetta Desktop under **能力市场 → 添加来源**:

\`\`\`
${input.repository}
\`\`\`

Abilities live under \`abilities/\`. The index is \`.vetta/marketplace.json\`; its derived fields are
maintained by \`npx @vetta-org/plugin-cli sync\`. See \`AGENTS.md\` for the working agreement.
`;
}
