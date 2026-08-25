# Runtime 默认 Prompt 缓存布局

## 状态

Accepted

## 背景

Runtime 已能把产品 Composer 声明的 `systemPromptStableLength` 传给 Provider，但最基础的动态 Agent 即使只使用
Session 内固定的 instructions，也必须额外实现 Composer 才能描述缓存布局。与此同时，Model Call Contribution
可以在每次调用生成日期、检索结果或其它动态提示；简单地把整段 Prompt 标为稳定会让易变尾段反复作废缓存，并使
“稳定前缀”合同失真。

Profile、Persona、Mode 等产品语义不能进入 Runtime。基座需要仅依据通用资源生命周期提供安全默认值，同时允许复杂
产品保留最终 Prompt 的控制权。

## 决策

Runtime Core 按 Instruction 的产生阶段自动编译 Prompt Cache Layout：

- `RuntimeCapabilityDefinition` 与 Feature 编译期产生的 instructions 随当前 Session Snapshot generation 固定，
  默认 cacheability 为 `stable`。
- `ModelCallContributionProvider` 在调用期产生的 instructions 可能随 Turn 或模型调用变化，默认 cacheability 为
  `volatile`。
- `InstructionBlock.cacheability` 是可选的显式覆盖。普通 Agent 不需要填写；声明者负责保证 stable 内容在 Session
  的相邻 Turn 中逐字不变。
- Layout 编译保持现有 `priority + id` 顺序。只有开头连续的 stable blocks 属于缓存前缀；首个 volatile block 以及
  后续所有内容属于易变尾段。Runtime 不为提高命中率改变 Prompt 语义。
- 没有自定义 Composer 时，Runtime 自动生成 `systemPromptStableLength` 和隐私安全的 block spans。完全静态的基础
  Agent 因此默认缓存整个 system prompt。
- 自定义 `ModelCallFrameComposer` 拥有最终 Prompt。它显式返回的 stable length/block layout 优先；也可通过最终
  Instruction 的 cacheability 请求自动布局。完全未声明时保持既有 Provider 兼容语义，Runtime 不猜测变换结果。
- Composer 返回越界 stable length、重叠/越界 block、重复 block id 或 stable-after-volatile 布局时，Runtime 把
  stable length 降级为 0，不中断模型调用，并发布 warning 级 `runtime.prompt.cache-layout-issue` Observation。事件只含
  原因码和数量，不含 Prompt、hash、Tool Schema 或错误 message。
- `instructionOverride` 替换完整 Prompt 时继续清空布局。Agent revision 更新不改变已有 Session；显式 rollout 只从
  下一 Turn 切换 Snapshot、模型绑定与缓存 generation。

## 备选方案

### 所有 Agent 必须实现 Composer

否决。基础 Agent 被迫理解 Provider 缓存细节，配置文件和代码配置会重复样板，违背基座开箱即用目标。

### 没有 Composer 时缓存完整 Prompt

否决。调用级 Contribution 可能变化，整个 Prompt 每次失效，且无法解释真正稳定的前缀。

### 把所有 Snapshot instructions 移到动态 instructions 之前

否决。Instruction priority 是模型行为合同，缓存优化不能重排 Prompt。动态块位于首部时保守得到 0 长度前缀。

### Runtime 解析 Profile 或 Prompt block 类型

否决。稳定性可以从生命周期与显式通用字段判断，不需要把产品概念下沉。

### 非法缓存布局直接终止模型调用

否决。缓存是优化能力，错误元数据不应让用户请求失败；安全降级和 warning Observation 足以暴露配置问题。

## 后果

- 静态或主要静态的自定义 Agent 零额外配置即可使用 Provider Prompt Cache。
- 动态 Prompt 仍可通过 Contribution Provider 进入易变尾段，且不会破坏稳定前缀。
- 高级产品保留结构化 Prompt 与缓存块控制权；Runtime 默认策略和产品 Composer 不形成两套 Prompt 事实源。
- 新增 Instruction 来源时必须明确其默认生命周期；无法证明跨 Turn 稳定时一律默认 volatile。
- Observation Adapter 可以统计自动、显式、未声明和降级布局，但不得采集 Prompt 正文。
