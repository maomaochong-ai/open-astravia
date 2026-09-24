# 首响应状态与初始化耗时核查（2026-09-23）

## 结论与取样范围

旧界面将「空 assistant 草稿且会话忙碌」显示成「等待模型响应」，而草稿早于 Runtime 创建。已有 trace 证明数秒的内部初始化可以被误认为模型首 token 等待。

此次只读取已存在的 Main 日志中的 `session creation trace` 与 `session initialization trace` 数值，按会话身份关联；没有发送真实 Provider 请求，也没有操作运行中的 Desktop。分别检查安装版与开发版最近五份日志，安装版找到三次 `operation=create` 样本，开发版未找到新建样本。以下是历史运行样本，不是本次源码修改后的受控性能基准，也不代表所有机器、插件配置或版本。

| 新建样本时间（日志本地时间） | Desktop 创建总耗时 | Coding Agent 内部初始化 | 初始系统提示词 | 提示词运行环境 |
| --- | ---: | ---: | ---: | ---: |
| 2026-09-19 10:58:14 | 7206.2 ms | 6888.7 ms | 4659.3 ms | 1957.2 ms |
| 2026-09-19 10:59:03 | 7264.2 ms | 6750.2 ms | 4618.2 ms | 1700.6 ms |
| 2026-09-20 17:21:46 | 5614.7 ms | 4438.5 ms | 3359.3 ms | 971.6 ms |

`prompt-runtime` 嵌套在 `turn-capabilities` 内，不能重复相加。三个样本中外设准备为 99.0～423.9 ms，插件技能准备为 1.2～1.9 ms；较慢的整体阶段是初始系统提示词与提示词运行环境，现有 trace 无法继续分出它们内部的文件读取、资源扫描和增强器耗时，不能据此指定某个插件为根因。

开发版当天 09:29:23 的一次恢复操作，Desktop 创建入口耗时 17783.9 ms，`runtime-create` 为 17754.9 ms，但内部 Session 初始化只有 2386.7 ms。两层之间约 15.37 秒尚未由这些阶段解释，可能范围是外层 Runtime 装配/恢复，不能归入模型响应。09:52:02 再打开同一个已激活会话只有 10.9 ms（`runtime-create` 0.4 ms），这属于复用，不是冷初始化性能。

## 当前流程与本次修正

```text
提交输入、显示用户消息和空草稿
  → 创建会话：配置、Runtime 装配、Session 初始化与提示词预览
  → 订阅事件、首次插件就绪等待、发送 prompt
  → 准备请求：输入、上下文、调用帧、凭证、上下文报告
  → model.request.started：进入 Provider 调用
  → Provider 原始事件、Renderer 输出批处理
  → 首段内容
```

会话创建期间显示「正在创建会话」，后续准备显示「正在准备请求」。收到真实请求边界事件才显示「等待模型响应」并开始相应计时；整轮总耗时保持原口径。切换回运行中的会话会回放请求边界，下一轮发送会清除上轮的瞬时请求时间。

本次修正状态与计时归因，没有删除初始化步骤，也没有声称初始化已经加速。要验证性能优化收益，需要同配置的新建样本；要分解恢复样本中约 15 秒的外层时间，需要补充 Runtime 装配级 trace。既有 trace 开启与字段说明见[会话切换性能诊断](./session-switch-observability-2026-08-20.md)，事件合同见 [ADR-0130](../../adr/0130-model-request-boundary-is-a-runtime-observation.md)。

## 验证结果

- 修改前的定向用例复现了缺少 Provider 请求边界，以及初始化期间错误显示等待模型的问题。
- 修复后核心定向测试 66 项通过：Runtime 的请求顺序、准备期间取消、安全观察投影、事件回放；Desktop 的 IPC 解码、新建发送、创建标签退场、连续发送、首响应计时，以及本地假 Provider 下的工具循环和重启恢复。没有调用真实模型或启动 UI 验证实例。
- 执行 `bun run test:changed -- packages/runtime-core/src/contracts.ts apps/desktop/src/shared/session-event-codec.ts`，覆盖 11 个包。Coding Agent、Runtime Core、Agent Team、Runtime Tools/MCP/Storage/Telemetry/Desktop 的整包测试通过；Runtime Node、CLI 和 Desktop 整包未通过，不能据此宣称全量测试绿灯。
- 整包失败包括 Windows 本机路径与 POSIX/SSH 测试夹具不匹配、部分用例超时、流式 Markdown 节点断言，以及会话视图测试缺少终端 IPC Mock。本次涉及的 ViewModel 测试已补齐该外部边界并复跑通过；Desktop Runtime capabilities 和配置测试共 12 项在单 worker 下复跑通过。
- CLI 图片附件用例在整包及同时进行的复跑中达到子进程 20 秒上限。整包结束后，使用修改前的请求执行实现作对照通过（用例约 5.1 秒）；恢复当前实现后同配置复跑也通过（约 5.8 秒）。这是超时复核，不能当作初始化性能对比，也不能断言超时根因已经解决。对照结束已逐字节恢复本次实现。
- `bun run check` 未全绿：根目录与 Desktop 的 `@vetta/ai/proxy` 路径映射守卫、计划模式提示词触发的旧架构术语守卫、`ensure-workspace-install.mjs` 缺少声明，以及已有流式揭示测试的字符串拼接提示仍存在。这些位置没有本次源码修改；本次新增代码的类型问题已消除。
- 发布说明校验和本次文件的 `git diff --check` 通过。没有改动初始化扫描、工具权限、插件加载顺序，也没有修改其他工作中的 Git 插件实现。
