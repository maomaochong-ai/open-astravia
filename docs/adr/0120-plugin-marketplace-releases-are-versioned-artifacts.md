# ADR-0120：GitHub 插件市场以版本化制品发布

- 状态：已接受
- 日期：2026-09-18

## 背景

GitHub 市场 v1/v2 从仓库归档中的 `source.path` 读取已构建插件，并把仓库级
`minAppVersion` 用作唯一的 App 兼容门槛。插件与 App 独立发布时，新插件可以先于
提供所需能力的 App 到达用户；旧 App 会看到更新，直到安装时才因 Plugin API 或
清单能力不匹配而失败。仓库里提交 `dist/` 还把构建结果混进源码历史，目录同步
与制品发布无法独立审核、晋级或回滚。

## 决策

1. GitHub 市场 schema v3 要求插件条目声明 `releases[]`；只在 Bundle 中出现的
   插件在该 Bundle 成员上声明相同字段。每个版本固定
   `version`、`minAppVersion`、`pluginApiVersion`、权限、命令、HTTPS ZIP URL 和
   SHA-256。顶层 `version` 等于最高的发布版本；`source.path` 只保存详情与图片等
   展示资源。v1/v2 的目录安装合同原样保留。
2. Desktop 在已验证目录快照中按当前 App 与 Plugin API 版本选择最高兼容版本。
   列表、Bundle 成员版本和安装使用同一选择结果。完全没有兼容版本的插件及
   依赖它的 Bundle 暂不展示；不会把不可安装版本标为可更新。安装时下载固定 ZIP，
   校验大小、SHA-256、包内插件身份、API、权限和命令，再走现有 Plugin Store。
3. 私有 GitHub 来源的令牌只发往与来源仓库坐标相同的 GitHub Release asset API；
   重定向到资源域名后不转发。其他 HTTPS 制品不携带来源令牌。
4. 正式市场晋级前运行 `check-plugin-marketplace-publication.mjs`：逐个检查插件
   声明的最低 App 版本确有已发布的稳定 GitHub Release、该 tag 的宿主 Plugin API
   满足要求、制品可下载且摘要一致。首次联调尚未发布的 App 版本时，市场可以显式
   把该版本钉到 40 位不可变 App commit；门禁只在稳定 Release 返回 404 时读取该
   commit，并核对 Desktop 版本、Plugin API 与 schema v3。稳定 Release 一旦存在就
   优先校验 Release，不能用候选 commit 绕过不完整发布。候选 ZIP 可以先构建，正式
   目录只引用通过门禁的固定制品，不在晋级时重建。
5. 旧客户端不认识 schema v3。发行方必须在旧 `main` 来源仍受支持期间维护它，
   新版 Desktop 改用单独的 v3 ref 或仓库；确认旧客户端退役后才移除旧来源中的
   构建文件。市场来源身份、缓存和安装台账仍按现有规则区分。

## 备选方案

- 只规定发布顺序并提高仓库级 `minAppVersion`：能暂缓抢跑，却会阻断旧 App
  使用整个市场，也无法给不同 App 提供不同插件版本。
- 在原有 schema v2 条目追加远程地址：旧客户端仍从 `source.path` 安装，并会把
  条目最高版本误当作目录内容；无法安全删除构建文件。
- 直接用 npm 或 OCI 作为市场：增加一套查询、认证和客户端选择机制；现有 ZIP
  安装器仍须保留。npm 分发信封（ADR-0067）继续供独立安装使用。
- 让 App 与插件共用一个发布流水线：牺牲独立发布，不解决第三方市场和旧客户端。

## 影响与验证

schema v3 是新增的市场协议；发行方负责双来源支持期。云市场服务端在私有仓库，
本决策不宣称已改变其单版本模型；云市场要获得相同行为，需要按 App/API 版本
返回兼容的插件版本及固定制品。

合同测试覆盖 schema 拒绝、版本选择、Bundle、旧目录路径、下载摘要与声明一致性；
服务测试覆盖浏览后安装的连续流程，发布门禁测试覆盖未发布 App、API 不足和制品
漂移。真实 GitHub Release 与各平台 App 的联合验收应在市场 v3 来源上线前执行。
