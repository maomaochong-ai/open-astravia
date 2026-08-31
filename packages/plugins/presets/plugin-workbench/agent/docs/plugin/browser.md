# 浏览器 API

`ctx.browser` 提供两类能力：`open()` 只负责把页面展示到 Desktop 内置浏览器；其余 session/snapshot/act API 是宿主管理的浏览器自动化能力。插件不应自行执行浏览器 CLI。

当前宿主始终提供 `ctx.browser`，创建这个 API 对象不会启动浏览器或进行导航。权限在调用具体方法时校验，缺少声明或用户授权时抛出 `Plugin permission denied: <permission>`。不要用 `ctx.browser` 是否存在判断权限；需要提前判断时使用 `ctx.permissions.has(...)`。兼容尚未提供该 API 的旧宿主时，仍需自行检测是否存在。

## 打开内置浏览器

如果插件只需要让用户查看一个页面，声明 `browser.open`，并调用：

```ts
ctx.browser.open("https://studio.example.com/posts");
```

`open()` 会打开当前会话的内置 Browser Panel。它只接受 `http` / `https`，并受清单中的 `browser.allowedHosts` 限制；不会返回页面内容，也不会授予点击、填充、脚本执行或 Cookie 访问权限。

没有活动会话时，`open()` 会抛出错误，不会创建新会话。只有 `browser.open` 权限也能使用该方法，不需要 `browser.read` 或安装自动化运行时。

## 清单

```json
{
  "permissions": [
    "browser.open",
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
const session = await ctx.browser.sessions.create({
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
