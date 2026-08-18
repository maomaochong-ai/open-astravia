---
status: accepted
---

# desktop「对话」项目按 session 拆产物 cwd

「对话」是 desktop 侧栏的默认项目、不可删除，扮演"sink"角色——任何无明确归属的 session 都落在它下面。ADR-0005 已经把 IM 与 desktop「对话」分家解决了渠道间窜味，但「对话」内部多个 desktop session 仍共用同一 cwd `~/.vetta/conversation`，agent 写出的 html/py/md 等产物全部堆在根目录：(1) 同名文件互相覆盖（A 的 `report.html` 被 B 覆盖）；(2) B 的 agent 在 ls 时能看到 A 的残留并可能误读。和 ADR-0005 同形态的「窜味」问题，只是发生在更细粒度。

决定：「对话」项目下任何**新建** session（手动 / scheduler / IPC 等所有口子），在创建时 main 进程 eager `mkdir -p ~/.vetta/conversation/<sessionId>/`，并把该 session 的运行 cwd 设为此子目录。Session jsonl 仍集中存于项目根 `~/.vetta/conversation/.vetta/sessions/`，不挪——sidebar 列表逻辑不动。删除 session 时一并递归删除其产物子目录，二次确认弹窗提示包含 N 个文件。

仅作用于「对话」默认项目。用户手动创建的项目（cwd 是用户自选的真实路径，比如代码仓）**不**走 per-session 拆分——共享 cwd 本来就是用户创建项目时的初衷。

fs IPC 沙箱边界**不**收紧，仍是 `~/.vetta/conversation` 整体。隔离的是状态不是权限：用户从 sess_A 拖一个产物文件作为 [[mentionedFile]] 进 sess_B，agent 仍能用绝对路径读到。强行硬隔离反而破坏跨 session 引用这个合理用例。

不做老 session 迁移：现有 session 的 cwd 保留为项目根，老产物原地保留可见。没有可靠信息能把"哪个文件是哪个 session 写的"反推出来，启发式迁移容易错绑。「对话」项目详情页（无激活 session 时）的 Files 面板仍展示项目根——同时能看到老产物 + 各 `<sessionId>/` 子目录，作为"索引页"。

子目录命名用不可变的 `sessionId` 而非 session title slug：session 可重命名，title slug 同步要么需要 mv + 改产物内相对引用，要么和真实目录脱节；sessionId 不可变换来稳定性，代价是 Finder 不可读，由 UI 提供"在 Finder 中打开本 session 产物目录"入口补偿。

权衡：放弃了"对话项目下所有 session 共享一个工作目录"的便利性（比如 sess_A 的 `data.csv` sess_B 直接 `./data.csv` 引）——但这种便利本质就是污染源。需要跨 session 复用产物时，走 mentionedFile 拖拽的显式路径，比靠 cwd 隐式共享更可控。

## 修订（2026-08-18）：工作区子目录不再作为「索引页」暴露

两点与最初决定不符的地方一并修正：

1. 实现中子目录名一直是 `randomUUID()` 而非本文写的 `<sessionId>`，以实现为准。
2. 撤回「Files 面板把项目根当索引页、可见各工作区子目录」的设计：uuid 目录对用户无可读性，
   在文件面板里呈现为一长列乱码目录，被用户理解为数据泄露而非索引。

改为：

- fs 的 UI 目录列举（文件面板树 `read-dir`、@文件递归补全 `list-files-recursive`）在「对话」根目录
  这一层隐藏 uuid 命名的工作区子目录（谓词 `isConversationWorkspaceDirEntry`，
  `apps/desktop/src/main/conversations/session-paths.ts`）。根目录下的老产物（非 uuid 命名）仍可见。
- fs 权限边界维持不变（仍是 `~/.vetta/conversation` 整体）：隐藏的只是列举展示，显式绝对路径
  （mentionedFile 拖拽等跨 session 引用）仍可读取，本 ADR 原有的「隔离状态而非权限」立场不变。
- 新会话页在「对话」/待创建项目上下文中不再把 conversation 根传给活动面板，文件面板显示
  「选择项目」空态；选中项目后按项目根展示。
