---
status: accepted
---

# 最终 Tool 表面使用 Turn-bound Projection

## 背景

Coding Agent 的 Tool 来自内置 Catalog、MCP、Plugin、Extension 和调用级组合。部分产品行为只属于模型侧表面，
例如 Work 模式消费的调用说明 `description`，以及自渲染 Plugin 卡片使用的 `md_intro`。此前这些字段由各 Tool
工厂或 Plugin Runtime 分别改写 `inputSchema`：静态工具容易漏加，动态工具无法天然覆盖；继续把字段沿注册、Catalog、
MCP 和组合调用链逐层传递，会让模型展示策略侵入执行合同并产生多个事实源。

同时，Tool 的动态变化并不只有 Schema：模型可见描述、标签、顺序和上下文归属也可能按宿主策略变化。但开放可修改
执行函数、权限或激活状态的万能 middleware，会绕过现有 Catalog、Tool Policy 和执行边界。

## 决策

1. `@vetta/runtime-tools` 提供平台中立的 `RuntimeToolProjectionPipeline`。Projector 按稳定 `order + id`
   排序，对 Tool Definition 做不可变投影；重复 id、非法顺序和试图改变稳定 Tool 名称均 fail-fast。
2. Projection 只能修改模型表面字段：`label`、静态 `description`、`inputSchema`、`modelOrder`、
   `contextSource` 和 `contextCategory`。`name`、执行函数、binding、激活、权限与副作用归原所有者，不能通过
   Projection 改写。
3. 修改 `inputSchema` 必须同时提供 `mapInput`。Runtime 先按投影后的 Schema 校验模型输入，再按投影逆序映射并调用
   原 validator/handler，保证宿主注入字段不泄漏到领域执行合同。显式 Tool 自有字段默认优先于宿主投影；产品只有在能
   识别历史宿主字段时才可 adopt 并接管其反向映射。
4. Projector 可通过 `bindForTurn()` 捕获动态配置，并与其它 Turn 资源一起释放。一个 Turn 内的多次模型调用使用同一绑定；
   普通外部更新只影响后续 Turn，部分绑定失败必须回滚已经获取的资源。
5. Coding Agent 在 Plugin、MCP、Extension 与 Catalog Tool 完成组合和排序后、执行 wrapper 之前应用最终投影。
   默认产品 Projector 为兼容的对象输入 Schema 追加可选 `description`（最多 100 字）；显式同名业务字段不覆盖。
   已使用共享旧 Schema 的调用说明由默认 Projector 接管并在执行前剥离。
6. Plugin 卡片的 `md_intro` 改用同一通用投影与输入映射机制；`rendersCard` 仍由 Plugin 产品域判断，通用 Runtime
   不理解卡片语义。
7. Projection 不承担能力集合、执行配置、权限或调用拦截：工具增删替换继续使用 Catalog/generation，执行配置继续使用
   `withCodingToolConfiguration()`，权限继续使用 Tool Policy，执行拦截继续位于最终执行边界。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 在每个 Tool Schema 中手工声明 `description` | 静态定义重复，动态 MCP/Plugin/Extension 容易遗漏，模型 UI 策略侵入领域输入 |
| 在每层 Options 中传递 Schema/description modifier | 组合链持续膨胀，调用者必须理解下游来源，动态状态难以维持 Turn 一致性 |
| 扩展 `RuntimeToolDefinition` 为任意 metadata/config 字典 | 字符串约定缺少所有权和类型边界，容易把权限、执行与展示策略混在一起 |
| 使用可任意改写 Tool 的 middleware | 能绕过稳定身份、授权和生命周期，不符合 Typed Pipeline 与最小能力边界 |
| 直接修改 Catalog 中的 Tool Definition | 将产品展示策略写回共享执行事实源，可能污染其它产品并破坏在途 Turn 稳定性 |

## 后果

- 新增 Tool 只需声明自己的真实执行 Schema；默认调用说明自动覆盖最终可见的动态工具来源。
- 模型侧可见 Schema 会多一个可选字段，但原 Tool validator 和 handler 的输入保持不变；真正拥有同名业务字段的 Tool
  保持原行为。
- 产品可新增小型、有序、可测试的 Projector，而无需修改所有 Tool provider。外部配置仍须在进入产品领域时校验，
  Projector 不是面向不可信 Plugin 的任意代码扩展点。
- 最终模型 Tool 表面成为上下文报告的事实源；投影必须在 wrapper 和 Provider 转换前完成。
- 每个 Schema 投影会增加一次显式校验/映射边界；应保持 Projector 数量小且职责单一，不把它演变为通用 middleware 总线。
