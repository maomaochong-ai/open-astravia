# Desktop 性能记录

- [首响应状态与初始化耗时核查](./session-first-response-2026-09-23.md)：记录已有日志的初始化耗时，以及创建、准备和等待模型三个阶段的显示边界。
- [团队会话创建与首响应优化对比](./team-session-startup-optimization-2026-09-23.md)：记录从创建、请求上传到首个文本的完整链路、资源竞争根因，以及四成员场景的优化前后数据。
- [侧边栏会话切换：跨进程性能诊断](./session-switch-observability-2026-08-20.md)：说明 Renderer、Desktop 包装层与 Coding Agent 初始化三层 trace 的开启、关联和解读方式。
- [新会话首次发送：先反馈、后初始化](./new-session-first-send-2026-08-19.md)：记录首次发送卡顿的复现、定位、执行顺序重构、前后对比与后续优化方向。

相关历史记录：[侧边栏切换、发送卡顿与入口首开优化（2026-08-18）](../sidebar-perf-081826.md)。
