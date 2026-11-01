# ADR-0154：能力体系收敛为单一「技能」，移除场景

## 状态

已接受。删除场景这一并列能力类型；技能、插件、MCP 三条能力通道不受影响，旧数据的读取兼容保留。

## 背景

能力体系里曾有两条几乎同构的通道：

| 面向 | 技能（skill） | 场景（scene） |
| --- | --- | --- |
| 落盘目录 | `~/.astravia/skills/<name>` | `~/.astravia/scene/<name>` |
| 清单字段 | `type: "skill"` | `type: "scene"` |
| Prompt 引用 | `promptRef.kind = "skill"` | `promptRef.kind = "scene"` |
| 会话展开标记 | `customType = "skill_expansion"` | `customType = "scene_expansion"` |
| UI | 技能列表 | 场景卡片 + 轮播 |
| 市场条目 | `type: "skill"` | `type: "scene"` |

差异只有「模板里是否附带 `tasks.json` 与初始 todo 锁」这一条，其余装载、校验、权限、审批、市场安装、卸载、Prompt 展开全部重复。代价是可测量的：

- `NodeConfig`、资源运行时、Prompt 构建、市场安装器、能力账本、卸载路径各自维护一份分支；每加一个能力类型就要同时改六处。
- 两套 UI 组件（`SceneCard`、`DefaultSceneCarousel`、`SceneCardView`、`SkillToggleSwitch`、`SkillDetailDialogView`）与技能组件并行存在，主题包内出现两套近似实现。
- i18n 需要两套命名空间，产品文案里「技能 / 场景」的边界对用户也不成立——两者都是「带说明文字的可复用提示词包」。

场景唯一不可替代的能力（模板附带待办清单）已经由技能承载：会话初始化时可以带 `todoItems` 与初始锁来源，装载逻辑与场景无关。

## 决策

### 1. 只保留技能

- `InstalledSkillType` 收敛为 `"skill"`；`getSceneDir()` 及全部调用点删除。
- 资源运行时、`PromptOptions.promptRef`、`SkillType`、市场安装/卸载 API 的 `type` 参数都只剩 `"skill"`。
- 删除场景专属 UI：`packages/theme-ui/src/chat/{SceneCard,DefaultSceneCarousel}.tsx`、`packages/theme-ui/src/skills/{SceneCardView,SkillCardView,SkillTagGroupView,SkillToggleSwitch,SkillDetailDialogView}.tsx`，以及桌面端已无引用的 `apps/desktop/src/renderer/domains/skills/` 目录。
- i18n 的 `skills` 命名空间只保留仍在使用的键（引导游标 `tour` 与内置能力说明 `builtin`）。
- 文档与配置路径参考里去掉 `~/.astravia/scene/` 一行。

### 2. 保留旧数据的读取兼容（不删）

这四处看起来像「漏改」，其实是刻意保留，删掉会破坏已有安装与会话：

- `skill-service` 卸载路径仍识别清单里的 `type: "scene"` 条目，让早期安装的场景包可以被正常卸载而不是变成幽灵目录。
- 市场索引解析仍用 `withoutLegacySceneAbilities` 过滤 `type: "scene"` 条目，避免旧缓存索引把已下线的类型重新装回来。
- 会话历史投影仍把 `customType: "scene_expansion"` 与 `promptRef.kind: "scene"` 读作技能展开，旧会话因此照常显示引用。
- 输入框仍把行首 `/scene:name` 当作 `/skill:name` 解析，旧会话里已固化的文本命令不会变成死链。

### 3. 待办锁来源保持 `"scene"`

`TodoLockSource` 是持久化枚举，值写进会话快照。改名会让所有已锁定待办的旧快照反序列化失败，而这与「场景能力是否存在」无关——知识处理会话今天仍以该来源初始化锁。因此类型名与字面量的历史包袱保留，语义按「会话初始锁」理解。

## 备选方案

| 方案 | 代价 |
| --- | --- |
| 保留两条通道，仅共享实现 | 仍然要维护两套 UI、两套 i18n、两套市场类型；共享层反而要处理两边的差异参数，收敛不到一处 |
| 把场景改造成「带待办的技能」并在技能内加一个布尔开关 | 用户侧只是多了一个选项，实现上仍然是双分支；而待办清单本来就是会话初始化的入参，不必挂在能力类型上 |
| 直接删除全部旧数据读取兼容 | 已安装的场景包会变成无法卸载的残留目录，旧会话的技能引用会显示为丢失。兼容成本极低（四处字符串判断），收益是「旧装上来的用户不会看到破损」 |

## 后果

- 能力类型只剩三种（技能 / 插件 / MCP），每加一个能力维度只需改一处。
- 主题包少两套近似组件，侧栏与设置页的能力列表只有一个渲染路径。
- 老用户升级后：场景包不再出现在能力列表；卸载入口仍可清理它们；旧会话仍显示技能引用。
- 市场侧仍需继续下发过滤逻辑，直到线上索引里不再有 `type: "scene"` 条目为止。
