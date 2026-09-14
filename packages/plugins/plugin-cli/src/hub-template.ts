import { AGENTS_GUIDE_REVISION } from "./agents-template.js";

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
	return `<!-- vetta-guide-revision: ${AGENTS_GUIDE_REVISION} -->
# ${input.name}

Vetta 能力市场仓库。本仓库索引若干**能力**（plugin / mcp / skill / scene / bundle），
每个能力是 \`abilities/\` 下的一个自包含目录。

## 开发时站在能力目录里，不是站在这里

> 仓库根没有 \`node_modules\`，所以在根上执行时用全名 \`@vetta-org/plugin-cli\`；进了能力目录、
> \`npm install\` 之后，裸命令 \`vetta-plugin-cli\` 才在 \`node_modules/.bin\` 里。

\`\`\`bash
cd abilities/plugins/<slug>      # ← 开发单位是这个目录
npm install
npx vetta-plugin-cli docs --check-latest   # 手册（随该目录装的 SDK 版本；顺带查是否落后）
npm run install:vetta            # 装进正在运行的 Vetta
npx vetta-plugin-cli watch       # 热更新
\`\`\`

每个插件目录自带 \`AGENTS.md\`，里面有该读哪些手册、以及不可违反的几条。**先 \`cd\` 进去再动手**：
所有开发命令都作用于「最近的那个能力目录」，站在仓库根上它们不知道你指的是哪一个。

手册与各目录的 \`AGENTS.md\` 都是那次 \`init\` 当天的快照，各能力还可能钉着不同的 SDK 版本。
动手前先跑 \`docs --check-latest\`，它的输出永远比这两份文件新，冲突时以它为准。

新建一个插件：

\`\`\`bash
npx @vetta-org/plugin-cli init --id <slug> --name "<Display Name>" abilities/plugins/<slug>
\`\`\`

它只创建目录，**不会**动索引——新能力什么时候上架是人的决定。想好了再按下面的方式登记。

## 索引由工具对账，不要手改派生字段

改完能力后：

\`\`\`bash
npx @vetta-org/plugin-cli sync          # 对账并回填，看输出
npx @vetta-org/plugin-cli sync --check  # 只报不写，非零退出（CI 用）
\`\`\`

\`sync\` 到底做什么，分三档看清楚——它不是万能的：

| 字段 | \`sync\` 的行为 |
| --- | --- |
| 条目 \`version\` | **回填**成能力包里的版本 |
| \`marketplaceVersion\` | 内容有变化时**尝试**推进。只认 semver（\`1.2.3\`）和纯整数；\`YYYY.MM.DD-NN\` 之类的格式推不动，会报出来要你手改 |
| \`config.api_version\` / \`config.permissions\` / \`config.commands\` | **不写**。宿主建目录时用 \`plugin.json\` 整个重算 \`config\`，索引里的副本读都不读。已经存在且与真源不符时 \`sync\` 会提醒你删掉或改对 |

所以 \`sync\` 跑完要看输出：它报出来的问题（尤其是推不动的 \`marketplaceVersion\`）没人会替你处理。

要**手写**的只有身份与展示：\`slug\`、\`name\`、\`description\`、\`source.path\`、\`category\`、\`tags\`、
\`detail\`。新能力上架时手动加一条这样的条目。

三条容易踩的约束，\`sync --check\` 会替你守住：

| 约束 | 漏了会怎样 |
| --- | --- |
| 条目 \`version\` 必须 == 能力包里的版本 | 宿主同步**直接失败** |
| \`plugin.json\` 的 \`entry\` / \`styles\` 必须在已发布目录里真实存在 | 本地能装，市场上装不了 |
| 改了任何内容必须换 \`marketplaceVersion\` | 客户端不报错、也不更新，用户永远收不到 |

第三条最阴险——它不报错。\`sync\` 只在版本号是 semver 或整数时才推得动，其余格式要你自己换。

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
