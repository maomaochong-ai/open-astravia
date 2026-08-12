# Turn Binding 的能力边界

Turn binding 解决的是“执行合同漂移”，不是把整个外部世界复制进 Turn，也不承诺一次执行无损完成。
判断一个状态是否进入 binding 时，按下面三个问题依次分类。

## 1. 三类状态

### 1.1 必须绑定：逻辑合同与资源身份

如果一个值在 Turn 中途变化会让模型看到的能力、权限或行为含义前后不一致，它必须在 admission 捕获：

- Model、reasoning、Provider/endpoint policy 与 credential identity；
- Agent Mode、Execution Mode、Sandbox base policy；
- Prompt、persona、AGENTS、Skill catalog/body 与资源内容 revision；
- Tool schema、普通 availability、registration filter 与 implementation identity；
- MCP 配置、Tool catalog、server generation identity；
- Plugin activation、Hook/interceptor/handler membership 与 Extension runner identity；
- compaction、图片处理等会改变模型输入语义的策略。

这里绑定的是不可变值、内容快照，或指向特定 generation 的句柄。它不要求对所有对象做深拷贝。

### 1.2 必须实时：执行状态与物理世界

如果状态由当前执行产生，或者复制后会失去意义，则保持实时读取：

- cancellation、deadline、Tool Call 授权交互与 Session grant ledger；
- messages、Tool Result、Todo、usage、compaction 游标与 deferred activation；
- 网络、DNS、限流、Provider 响应及远端服务健康；
- Plugin worker、Renderer、MCP process、socket 与子进程的存活和输出；
- Tool 实际读取的文件系统内容、时钟、随机数与其他外部副作用；
- 不改变 credential identity、scope 和 endpoint policy 的 provider-owned token rotation。

绑定对象可以包含一个指向实时服务的 port。例如，Turn 固定某个 MCP server generation，但该 generation 的
连接健康仍是实时的；Credential binding 固定账号/权限身份，但实现可以在同一身份内返回轮换后的短期 token。

### 1.3 必须实时收紧：安全撤销

下面的变化允许影响活动 Turn，但只能减少权限或取消执行：

- credential logout/revoke；
- Plugin、Tool、MCP capability 的 hard revoke；
- 组织 kill switch、敏感路径新增 deny、Session grant 撤销；
- 用户显式取消或“立即停止并禁用”。

普通 reload、disable、uninstall 或配置替换不能伪装成 hard revoke；权限放宽也不能通过实时通道进入活动 Turn。

## 2. Lease 实际保证什么

Generation lease 只提供两项保证：

1. 普通更新不会把活动 Turn 改绑到新 generation；
2. 宿主不会仅因为普通 retirement 主动销毁旧 generation 仍需的 handler、runner、host 或 connection owner。

Lease 不保证：

- 进程、连接、网络、凭证服务或远端 Provider 持续可用；
- 文件系统和外部数据库保持 admission 时内容；
- Tool 副作用可回滚、幂等或一定成功；
- 崩溃后一定能恢复到相同物理实例；
- Turn 能够无损、无错误地执行到自然结束。

因此“旧 generation 可以继续被调用”不能表述成“旧 generation 一定可以完成”。物理故障按原有错误、取消、
重试和恢复合同传播，且不得为了隐藏故障而静默切到新配置 generation。

## 3. 重连与恢复

恢复只能在逻辑合同保持不变时发生：

- 可以用同一 MCP 配置、同一 server identity 和兼容 Tool schema 重建 transport；
- 可以在同一 credential identity、scope 和 endpoint policy 内轮换短期 token；
- 可以重启实现明确支持恢复的 worker，但 handler identity 和协议必须保持同代。

如果恢复需要新配置、新账号、不同权限、不同 Tool schema 或新的 Plugin activation，应让当前调用失败，由下一个
Turn 捕获新 generation。实现不能把“提高成功率”作为跨代切换的理由。

## 4. Admission 捕获合同

`AtomicRuntimeSnapshotProvider` 会在同一个 JavaScript job 中启动 Model binding 和各领域 binder。每个 binder
仍必须在自身第一次 `await` 之前捕获 published pointer；之后的异步工作只能使用已捕获值。框架无法替一个先
`await` 再读取 `current/latest` 的 binder 补救原子性。

这个约束应通过小型、领域专属 binder 和带 barrier 的回归测试维护，不通过复制整个进程状态实现。

## 5. Credential 的当前保守实现

当前 Runtime fallback 在 admission 解析并封装 secret，同时记录 revocation revision。普通 refresh 不会改变旧
binding，显式清除会让旧 binding 的下一次 `resolve()` fail-closed。这保证不会在 Turn 中途切换账号，但长 Turn
可能因短期 token 到期而失败。

未来如果 Provider 能证明轮换前后保持同一 credential identity、scope 和 endpoint policy，可以把实时轮换封装在
同一个不透明 binding 中。不得简单地在每次调用时重新解析全局“当前凭证”，因为那可能跨账号或扩大权限。
