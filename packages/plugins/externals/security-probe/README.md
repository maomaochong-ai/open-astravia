# Security Probe Plugin

外置安全探针插件，用于审计 Desktop 插件系统的信任边界、权限门控与隔离缺陷。

> **信任前提（ADR-0023）**：插件在 renderer 内与宿主共享 React / DOM / `window.vetta`，**没有** iframe 或 worker 沙箱。安全依赖策展上架与权限门控，而非进程隔离。

## 它测什么

| 类别 | 关注点 |
| --- | --- |
| 信任模型 / 运行时隔离 | 同 document DOM、localStorage、原生 fetch、`window.vetta` 暴露 |
| 权限门控 | `ctx.permissions` / `fs` / `network` / `storage` / `conversation` deny 路径 |
| 存储命名空间 | `../` 穿越、绝对路径、空字节 |
| 文件系统边界 | 项目外写、homedir 预览读、直接宿主 `window.vetta.fs` 旁路 |
| 网络边界 | `file://`、localhost/metadata SSRF 面、`openExternal` 协议 |
| Official / 命令 | gateway 是否注入、official API 拒绝、未声明 command、管理面 list |

状态语义：

- **通过**：预期成功路径正常
- **已拦截**：宿主正确挡住了危险操作
- **发现**：安全相关暴露（含「设计如此但影响大」的信任模型后果）
- **跳过**：缺权限 / 无活动项目等前置条件
- **错误**：探测本身异常

## 构建

```bash
# 仓库根
bun install

cd packages/plugins/externals/security-probe
bun run build
```

产物 zip：

```text
packages/plugins/externals/security-probe/release/security-probe-0.1.0.zip
```

## 安装

设置 → 插件 → 从 zip 安装，或 DevTools：

```js
const file = await window.showOpenFilePicker({
  types: [{ description: "Vetta plugin", accept: { "application/zip": [".zip"] } }],
});
const buffer = await (await file[0].getFile()).arrayBuffer();
await window.vetta.plugins.installFromArchive(buffer, {
  // 建议先只开 UI，再逐步加敏感权限做对比
  grantedPermissions: ["ui.slot.global", "ui.slot.activity-tab"],
  enable: true,
});
```

完整权限（高危，仅本地审计机）：

```js
await window.vetta.plugins.grantPermissions("security-probe", [
  "ui.slot.global",
  "ui.slot.activity-tab",
  "workspace.read",
  "agent.session.read",
  "agent.session.write",
  "agent.command.run",
  "fs.read",
  "fs.write",
  "network.fetch",
  "storage.read",
  "storage.write",
  "shell.openExternal",
]);
```

## 推荐测试流程

1. **最小授权**（仅 UI）运行全部探测 → 敏感 API 应为「已拦截 / 跳过」。
2. **逐步授权** `storage.*` → 验证命名空间穿越仍拦截。
3. 授权 `fs.read` → 观察 homedir / `~/.ssh` 预览读是否成为「发现」。
4. 授权 `network.fetch` → 观察 localhost SSRF 面。
5. 授权 `agent.command.run` + 启用 `node` 命令 → 验证声明命令可跑、未声明 `curl` 被拒。
6. 始终关注 **`window.vetta` 旁路** 与 **DOM 共享** 类「发现」——这是信任模型根因，不是单点 bug。

## 已知风险清单（分析结论）

实现本插件前对宿主代码的静态结论；运行探针可动态复核：

1. **无沙箱（设计）**：插件 = 宿主 renderer 代码权限（ADR-0023）。
2. **`window.vetta` 全量暴露**：`contextBridge.exposeInMainWorld("vetta", api)` 对所有插件脚本可见；`PluginPermission` 只包住 `ctx.*`，不包直接宿主调用。
3. **原生 `fetch` 不经 `network.fetch` 权限**。
4. **`fs.read` 预览路径含整个 homedir**（`assertPathReadableForPreview`），宽于写路径的项目根限制。
5. **`network.fetch` 主进程代发无 SSRF 黑名单**（仅协议 http/https + 体积/超时）。
6. **命令一旦声明且启用**：可传任意 args/env（文件名级 allowlist，非子命令级）。
7. **系统插件自动全量授权且不可撤**；本探针为 external，可模拟用户授权粒度。
8. **存储命名空间**有 path resolve 校验（穿越/绝对路径/空字节应失败）——探针会验证。
9. **Official / gateway** 依赖 `trustLevel === "official"`；external 应被拒。

## 注意

- 不要在生产数据工作区对未知插件授予 `fs.write` / `agent.command.run` / `network.fetch`。
- 探针会尝试读 `~/.ssh/id_rsa` 等路径以验证边界；**不会**把内容上传，细节只留在本机 UI / 导出 JSON。
- 写探测目标是「应失败」的路径；若出现「发现」且写成功，请立即检查磁盘并视为真实漏洞。
