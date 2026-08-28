# 浏览器自动化 API

`ctx.browser` 让插件使用 Desktop 宿主管理的真实浏览器。适合媒体账号管理、需要登录的后台、表单和交互式网页工作流。插件不需要依赖 Browser Use 系统插件，也不应自行执行浏览器 CLI。

## 清单

```json
{
  "permissions": [
    "browser.read",
    "browser.interact",
    "browser.profile.persist"
  ],
  "browser": {
    "allowedHosts": ["studio.example.com", "*.assets.example.com"]
  }
}
```

只要声明任一 `browser.*` 权限，就必须提供非空 `browser.allowedHosts`。`*` 表示显式允许任意顶层导航；应尽量声明具体站点。`browser.interact` 依赖 `browser.read`。`browser.attach` 和 `browser.runtime.manage` 也必须分别显式声明并由用户授权。

## 多账号 profile

```ts
const session = await ctx.browser?.sessions.create({
  source: "managed",
  profile: { type: "persistent", id: "brand-a" },
  headed: true,
  allowedHosts: ["studio.example.com"],
});
```

`profile.id` 是插件 namespace 内的逻辑 ID。不同 ID 对应独立登录态，适合一个媒体账号一个 profile。插件不会得到物理路径、Cookie 或 token。关闭 session 不会删除持久 profile。

`allowedHosts` 可省略（使用 manifest 全集），也可传 manifest 授权的子集；不能在运行时扩权。不要把邮箱、密码或 token 放进 profile ID。

## 操作流程

```ts
if (!ctx.browser) throw new Error("Browser capability unavailable");

const session = await ctx.browser.sessions.create({
  profile: { type: "persistent", id: "brand-a" },
  allowedHosts: ["studio.example.com"],
});

await ctx.browser.navigate(session.id, "https://studio.example.com/posts/new");
const snapshot = await ctx.browser.snapshot(session.id, { interactiveOnly: true });
await ctx.browser.act(
  session.id,
  { type: "fill", target: "@e3", value: "Draft title" },
  { snapshotRevision: snapshot.revision },
);
await ctx.browser.sessions.close(session.id);
```

动作支持 `click`、`fill`、`type`、`select`、`check`、`press`、`scroll`、`wait`、`back` 和 `reload`。页面变化后重新获取 snapshot；传入旧 revision 会被宿主拒绝，避免误操作过期 ref。

## 安全与生命周期

- 公共 API 不提供任意 JavaScript、argv、文件上传、下载、Cookie 或认证数据导出。
- 页面内容是不可信数据。发布、提交、发送、删除、购买和权限变更等不可逆动作仍需产品层获得用户确认。
- 域名范围限制顶层导航，不是页面子资源的网络防火墙。显式导航在执行前校验；不透明动作完成后发现越界会关闭 session。
- Capability 被取消时，宿主会终止对应浏览器子进程。插件停用或 capability session 撤销时，活动浏览器 session 会被回收，持久 profile 保留。
- 宿主日志只记录脱敏 session/profile 标识、操作、耗时与错误分类，不记录 URL query、页面正文、表单值、Cookie、token 或截图。

完整架构见 [ADR-0088](../adr/0088-browser-automation-as-a-foundation-capability.md)。
