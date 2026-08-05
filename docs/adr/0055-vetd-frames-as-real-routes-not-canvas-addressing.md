# Vetta UI Design：frame 用真实路由寻址，而非画布内部编号

设计画布的 frame 原先靠 hash 寻址（`http://127.0.0.1:<port>/#/frame/login`）——那是画布内部的编号，不是地址。为了让「预览模式」可以像点真实产品一样点设计稿，我们把引擎换成 **react-router + BrowserRouter**，一个 frame 就是一条真实路由：`frames/login.tsx` → `/login`，`frames/index.tsx` → 站点根 `/`（没有 index 时根路径重定向到字典序首帧）。画布 iframe、预览窗口、系统浏览器、以及将来直接部署出去的静态站点，用的是同一套地址。

理由：ADR-0053 已经确定「产出物直接是可交付的前端代码」是这条路线的天花板诉求。设计稿要能一键部署上线时，`#/frame/login` 这种地址就是必须推翻的中间产物；而现在是迁移成本最低的时刻——frame 之间还不存在任何存量链接。

## Considered Options

- **A 保留 hash，预览另做一层跳转协议**：改动最小，但 frame 源码里的跳转会写成只有本插件认识的形式，部署形态与预览形态永久分叉。
- **B 自制极薄 Link/navigate（内部改 hash）**：零新依赖、无需重装引擎，agent 写法可与 react-router 一致。但仍是假路由，且将来替换时存量 frame 的行为要重新验证。
- **C react-router + 真 path（选定）**：agent 写的是标准 `<Link to="/dashboard">`，四个运行环境行为一致。

## Consequences

- 引擎新增 `react-router` 依赖，`ENGINE_VERSION` 升到 0.2.0：用户下次打开设计稿会重跑一次 `npm install`（分钟级，有进度条）。这是本决定唯一的用户可感代价。
- 导出快照走 `srcdoc`（`about:srcdoc` 下没有可写的 history），必须分叉成 `MemoryRouter`；选帧继续用既有的 `show-frame` postMessage，存量分享包不受影响。
- 引擎的 `resolve.alias` 必须钉住 `react-router`：frame 源码在引擎根目录之外，node 解析走不到 `engine/node_modules`。
- bridge 协议扩出导航面：`navigate`/`reload`（父 → iframe）与 `navigated`（iframe → 父，带 `canBack`/`canForward`）。前进/后退的可用性由引擎自己维护的历史栈给出——History API 只让你 `go(-1)`，从不告诉你还能不能后退。
- `.vetd` manifest 不记录任何 URL，存量设计文档零迁移。
- 「哪一帧是首页」成了 `index.tsx` 这个文件名约定，而不是画布上的摆放位置——部署出去的根地址不该取决于用户把哪个框拖到了左上角。
