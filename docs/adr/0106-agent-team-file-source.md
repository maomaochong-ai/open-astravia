# ADR-0106：Agent Team 文件源与统一团队模型

## 状态

已接受（首期实现）

## 背景

当前 Agent Team 有两个事实源：`@vetta/agent-team` 在 TypeScript 中写死随应用提供的初始 Agent/Blueprint/团队，Desktop 又把运行时聚合结果写入 `agent-teams.json`。初始项还被 UI 和 Store 当作特殊对象处理。这样会造成默认数据、运行时和用户修改之间的分叉，也无法自然地支持从文件增加团队。

## 决策

1. 不定义“预设”领域类型。应用发布包只提供首次安装用的初始团队模板；安装到配置目录后，它就是普通 Agent Team 文件，与用户新建团队使用完全相同的读、改、删、导入流程。
2. 使用现有 `VETTA_HOME` 作为根目录：生产默认 `~/.vetta`，开发/验证通过 `VETTA_HOME=~/.vetta-dev` 隔离。团队统一存放在 `${VETTA_HOME}/agent-teams/<team-id>/`，每个目录都是一个普通团队资源。
3. 团队采用“目录 + 小型元数据 JSON + 内容文件”的版本化合同，不把所有内容塞进一个 JSON。首期布局如下：

   ```text
   agent-teams/
     index.json                    # schemaVersion、全局 revision
     agents/                      # 可被多个团队引用的共享 Agent Profile
       leader/
         agent.json                # ID、版本、能力选择、blueprint 引用
         description.md            # 长职责说明
         system-prompt.md          # 可选的系统提示词覆盖
     vetta-team/
       team.json                   # 团队元信息、成员索引、策略引用
       description.md              # 团队长描述
     research-team/
       team.json
       description.md
   ```

   `team.json` 和 `agent.json` 只保存结构化元数据；系统提示词、长描述、行为规则等内容使用独立 UTF-8 文本文件（默认 Markdown）。运行时由 Desktop 文件仓库解析为现有 `AgentTeamDocument` 投影，Runtime Core 不直接访问文件系统。
4. 首次读取空目录时将应用提供的初始团队物化为上述普通文件；之后只读取文件，不再按启动次数重新注入。`.initialized` 标记用于区分“尚未安装”和“用户已删除全部团队”，用户删除该团队后不会被任何隐式逻辑恢复。
5. 所有编辑（包括名称、描述、头像、mention handle、能力和高级 Blueprint 提示词）都写回来源目录中的对应文件，使用 revision 乐观锁与临时文件 + 原子替换。文件 ID 是稳定身份，不能因改名改变；单个内容文件的变更不应重写无关文件。
6. 外部文件导入先读取为 `unknown`，完成 schema、相对路径、ID 唯一性、成员引用、策略注册、文件大小和符号链接限制校验，再复制到 `VETTA_HOME/agent-teams/`；冲突时要求用户选择新 ID 或覆盖，不允许静默覆盖。
7. 新版本不读取旧版 `desktop-app/agent-teams.json`。旧数据不属于新文件合同，用户可按版本升级策略清理；新版本只处理新的目录文件。

## 后果

- `.vetta` 和 `.vetta-dev` 下看到的就是可编辑、可复制、可版本控制的团队目录；不存在“应用团队”和“用户团队”两套运行模型。长提示词和描述可以独立 diff、复用和审查。
- 文件目录是持久化唯一事实源，内存索引只是缓存；新增团队不需要改 TypeScript、编译或发布客户端。
- 删除、导入和文件冲突会成为必须测试的持久化边界；需要补充文件监听/刷新策略时，也只影响 Desktop Store，不扩散到 Runtime Core。
- 多团队共享同一 Agent Profile 时，可在文件合同中使用显式 Profile 引用；若需要完全自包含导入，则复制 Profile 并生成新的稳定 ID，不能靠隐式别名维持一致性。

## 与 ADR-0099 的关系

本 ADR 取代 ADR-0099 第 8 条及其“应用内置团队不可改写”的产品约束；ADR-0099 关于 Team Session、公开上下文和 Runtime 生命周期的其余决策继续有效。

## 不在本决策范围

- 不决定云端同步、市场分发或跨设备合并。
- 不允许文件中的 Agent 绕过现有能力权限、策略注册表或 IPC 校验。
