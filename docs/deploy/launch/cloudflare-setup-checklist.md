# Cloudflare 使用流程清单（DNS + Pages 官网 + R2 下载）

> 前置：域名已在 Dynadot 注册完成（见 [dynadot-registration-checklist.md](dynadot-registration-checklist.md)）。
> 整体方案：[website-deployment.md](website-deployment.md)（第 6 节架构、第 9 节计划）。
> 本文是照做式清单：注册账号 → DNS 托管 → Pages 官网 → R2 下载桶 → 验证。
> 界面为 Cloudflare 英文控制台，菜单名以实际页面为准（个别旧版本界面有中文）。

---

## 1. 前置条件

| 项 | 状态 |
|---|---|
| 域名 astravia.dev | 已在 Dynadot 注册完成（含 ICANN 邮箱验证） |
| 官网源码 | 本地构建产物 `dist/`（**官网仓库可不放 GitHub**，用直传部署，见第 4 节方式 A） |
| 安装包产物 | 后续版本发布时生成（DMG / EXE / AppImage） |

全程免费：Cloudflare 免费计划。DNS / CDN / Pages / R2 免费额度见第 8 节。

## 2. 注册 Cloudflare 账号

1. 打开 [cloudflare.com](https://cloudflare.com)，点 Sign up。
2. 邮箱 + 密码注册，查收验证邮件并确认。
3. 登录后进入 Dashboard，**不需要选任何付费计划**，默认免费计划即可。

## 3. 接入 DNS（关键步骤）

1. Dashboard 首页点 **Add a site**，输入 `astravia.dev`，选 **Free（免费）** 计划。
2. Cloudflare 自动扫描现有 DNS 记录（此时可能只有几条默认记录），点 **Continue**。
3. Cloudflare 分配两个 nameserver（形如 `xxx.ns.cloudflare.com`、`yyy.ns.cloudflare.com`）——**复制保存**。
4. 去 Dynadot 后台改 NS：Manage Domains → 选中 `astravia.dev` → **Nameservers** → 选"自定义 Nameservers" → 粘贴 Cloudflare 给的两个 NS → 保存。
5. 回到 Cloudflare，点 **Done, check nameservers**。
6. 状态从 **Pending Nameserver Update** 变为 **Active**（通常几分钟到几小时，最长 48 小时），即表示 DNS 已由 Cloudflare 接管。

## 4. 部署官网（Cloudflare Pages）

### 4.1 方式 A：Direct Upload（直传，推荐——官网源码不进任何远程仓库）

官网源码只留在本地，构建产物直接上传，**不涉及 GitHub**，适合不想公开/托管源码的情况。

1. 本地写好官网（纯 HTML 或 Vite/Next 等框架），跑构建得到 `dist/` 文件夹。
2. 控制台左侧 **Workers & Pages** → **Create** → **Pages** → **Direct Upload**。
3. 给项目起名（如 `astravia-website`），把 `dist/` 整个文件夹拖入上传，自动生成 `xxx.pages.dev` 地址。
4. **后续更新**：改完重新构建 → Pages 项目 → **Create new deployment** → 再次拖入新 `dist/` → 自动替换发布。
5. 自动化：`wrangler pages deploy dist/ --project-name=astravia-website`（可并入发版脚本）。

### 4.2 方式 B：连接 Git 仓库（可选——仅当你想把源码放 GitHub）

支持**私有仓库**（授权后 Cloudflare 可读，源码不会公开），推 `main` 自动构建发布。

1. 控制台左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
2. 授权 GitHub → 选择官网仓库（如 `astravia-website`）→ 分支选 `main`。
3. 配置构建设置：
   - **Framework preset**：按你的技术栈选（纯静态选 None / 静态 HTML；框架站选对应预设）。
   - **Build command**：`npm run build`（或对应命令）。
   - **Build output directory**：`dist`（或对应输出目录）。
4. 点 **Save and Deploy**，等构建完成（免费计划每次构建最长 20 分钟）。
5. 部署后得到一个 `xxxx.pages.dev` 域名，可先访问验证。


## 5. 绑定自定义域名（含实战踩坑）

> 实战总结：绑定域名有**两个入口**，用错会卡死。核心结论：**用 "Custom Domains and Routes" 区块里的 `+ Add Domain`，不要用 Worker URL 旁的 "Connect domain" 按钮**。

### 5.1 两个入口的区别（先看这个，避免白折腾）

| 入口 | 位置 | 支持子域？ | 结果 |
|---|---|---|---|
| **Connect domain** | Worker 概览页 Worker URL 旁 | ❌ 只认 zone 根域 | 输入 `www.xxx.com` 报 **"No zones match www.xxx.com"**，无法添加 |
| **+ Add Domain** | 页面下方 **Custom Domains and Routes** 区块（标题右上角） | ✅ 支持 | 正确入口，弹窗填子域名即可 |

- "No zones match" 的报错原因：用错了入口（Connect domain 只匹配 zone 级域名，如 `astravia.dev`，找不到 `www.astravia.dev` 这个子域）。不是域名问题，换入口即可。
- 若误入 "Connect your domain"（Onboard 新站点向导，有 Import DNS records / Continue 按钮）——那是给未接入 Cloudflare 的域名用的，**点 Back 退出**，别继续。

### 5.2 添加 www 与根域（官方方式）

1. 进入你的项目（Workers & Pages → 项目名，Pages 或 Worker 均可）→ 找到下方 **Custom Domains and Routes** 区块 → 点 **+ Add Domain**。
2. 弹窗 "Connect to astravia.dev"：
   - 添加 `www.astravia.dev`：在 **Subdomain (optional)** 框填 `www`（留空 = 根域）→ **Add domain**。
   - 添加根域 `astravia.dev`：Subdomain 留空 → **Add domain**（Cloudflare 自动处理根域解析）。
3. 等列表状态变正常（几秒到几分钟）。Cloudflare 会自动创建 DNS 记录、签发 TLS 证书、配置路由——**不需要手动去 DNS 加记录**。
4. **禁止手动在 DNS 加 CNAME 指向 `xxx.workers.dev`/`xxx.pages.dev`**：这种旧式做法 Cloudflare 无法正确回源，访问报 **HTTP 522**（源站连接失败）。必须用上面的官方绑定。
5. 绑定完成后检查根域记录：添加子域后**确认 DNS 里根域 `astravia.dev` 的记录仍在**（Type 显示 Worker / Pages，或 A 记录 Proxied）。若根域记录消失（解析为空、访问超时），在 DNS → Records → Add record 补：Type `A`、Name `@`、内容任意占位（如 `192.0.2.1`）、**Proxy 开橙色**，或用 Worker/Pages 类型的记录重新绑根域。
6. 清理历史占位记录：删除指向非自有服务器 IP 的 A 记录（如 `185.53.179.128` 的 `www` / `*` / `@` 三条），确认无实际用途后删。
7. 验证：浏览器分别打开 `https://www.astravia.dev` 与 `https://astravia.dev`，均显示官网且 HTTPS 锁正常。首次访问 Cloudflare 自动签证书，可能多等十几秒。
8. **手机打不开 / 电脑能开手机不能**：说明记录已配置成功（`dig +short A www.astravia.dev @8.8.8.8` 有 Cloudflare IP、电脑 HTTPS 200），是 **DNS 传播与缓存延迟**，不是配置问题。处置见下表。

| 步骤 | 操作 | 原理/说明 |
|---|---|---|
| 1 | 手机浏览器开**无痕窗口**访问 `https://www.astravia.dev` | 排除浏览器缓存了之前的失败结果 |
| 2 | 开**飞行模式 10 秒再关**（蜂窝网络） | 强制重新发起 DNS 解析，刷新运营商缓存 |
| 3 | **切换网络**：Wi-Fi ↔ 4G/5G 流量 | 两个网络的 DNS 服务器不同，通常有一个已生效 |
| 4 | 连 Wi-Fi 时**重启路由器**（拔电 30 秒） | 路由器会缓存旧 DNS 结果；重启可清除 |
| 5 | 仍不行则**重启手机** | 清空系统级 DNS 缓存 |
| 6 | 在线验证 DNS 是否已生效：浏览器打开 `https://1.1.1.1/dns?name=www.astravia.dev` | Cloudflare 官方 DoH 查询页，返回 `A 104.21.x.x/172.67.x.x` 即已生效；若生效手机还打不开，换网络再试 |
| 7 | 对照测试：手机访问 `https://astravia.dev`（根域） | 根域能开而 www 不能 = 纯 DNS 缓存问题；两者都不能 = 本地网络到 Cloudflare 连通性问题（换 4G/5G 验证） |

   - 背景：`www` 从「无任何 DNS 记录」到「有记录」后，运营商/路由器/手机可能缓存了旧的失败结果；新记录传播一般**几分钟到数小时**（最长 48 小时）。只要电脑侧 `dig` 有结果且 HTTPS 200，配置本身已成功，耐心等传播即可，不要重复绑定。

## 6. 创建 R2 下载桶

### 6.0 先激活 R2（需要付款方式，免费额度内 $0）

- 首次进入 R2 会先看到 **Activate R2 激活页**：要求填账单地址 + 选付款方式（PayPal / 国际信用卡 / Google Pay 等），**即使完全免费也要登记**。
- 账单地址可用美国免税州模板（俄勒冈 OR 波特兰，字段见 [dynadot-registration-checklist.md](dynadot-registration-checklist.md) 第 5.1 节；不涉及 ICANN 合规，账单地址可虚拟）。
- 免费额度（10GB 存储 / 100 万次 Class A 操作 / 1000 万次 Class B 操作 / 出网流量 0 费用）内每月 **$0 不扣款**。
- 若付款校验失败/风控：把账单地址改成付款卡真实登记的国家与城市（如 China/Guangdong）即可通过。

### 6.1 没有可用付款方式？备选方案（按推荐排序）

| 方案 | 优点 | 缺点 | 适合场景 |
|---|---|---|---|
| **GitHub Releases** | 完全免费、无需付款方式、已有账号；README 下载按钮已指向 Releases | 国内下载速度一般；单文件限 2GB | 最省事兜底，插件包/安装包直接传 Releases 即可提供直链 |
| **Backblaze B2** | 10GB 免费、S3 兼容、公开桶直链、注册不强制绑卡 | 需国际网络环境注册；配合 Cloudflare 走带宽联盟（Bandwidth Alliance）出网免费 | 想要"对象存储直链"但激活不了 R2 的替代 |
| **阿里云 OSS / 腾讯云 COS** | 国内访问快；支持支付宝开通，实名即可 | 需实名认证；绑定自定义域名需备案（用默认域名外链则无需备案） | 主要用户在国内、愿意实名 |

**决策顺序**：先试 R2（部分国内银联卡/PayPal 可用）→ 激活不过再用 GitHub Releases 或 B2。

### 6.2 创建桶：一个桶 + 目录分区（插件与应用共用）

**决策**：插件发布包与跨平台应用安装包**放同一个桶**，用目录分区。原因：R2 免费额度（10GB 存储等）是**账户级共享**，分桶不增加额度，反而多一套管理；一个桶 + 一个自定义域名（`dl.astravia.dev`）即可承载所有下载。仅当插件与应用需要完全隔离的权限/统计/子域名时才分桶（个人项目不需要）。

1. 控制台左侧 **R2** → **Create bucket**。
2. 桶名称：`astravia-downloads`；区域选 **APAC（亚太）** 或默认自动；点创建。
3. 开启公共访问：进入桶 → **Settings** → **Public access** → 开启后获得公共 URL（`<bucket>.r2.dev`，形如 `pub-xxxx.r2.dev`）。
4. **绑定自定义域名（推荐，更专业）**：桶 → **Settings** → **Custom Domains** → 添加 `dl.astravia.dev` → 按提示在 DNS 中添加 CNAME（`dl` → Cloudflare 给出的目标），保存后等生效。
   - 完成后下载直链为：`https://dl.astravia.dev/<路径>`。

## 7. 上传安装包与更新元数据

### 方式 A：控制台网页上传（少量文件）

桶 → **Upload objects** → 拖入文件。建议目录结构：

```
astravia-downloads/            ← 一个桶，插件与应用分区共存
├── plugins/                   ← 插件发布包
│   └── astravia-plugin-1.0.0.zip
└── app/                       ← 跨平台应用安装包
    └── v0.1.0/
        ├── astravia-0.1.0-mac.dmg
        ├── astravia-0.1.0-win-x64.exe
        ├── astravia-0.1.0-linux.AppImage
        ├── latest.yml          # electron-updater 元数据（Windows 用）
        └── latest-mac.yml      # electron-updater 元数据（macOS 用）
```

对应直链（绑定 `dl.astravia.dev` 后生效）：
- 插件：`https://dl.astravia.dev/plugins/astravia-plugin-1.0.0.zip`
- 应用：`https://dl.astravia.dev/app/v0.1.0/astravia-0.1.0-win-x64.exe`

### 方式 B：Wrangler CLI（自动化/发版脚本用）

```bash
npm install -g wrangler     # 安装
wrangler login              # 浏览器授权登录
wrangler r2 object put astravia-downloads/app/v0.1.0/astravia-0.1.0-win-x64.exe \
  --file=./dist/astravia-0.1.0-win-x64.exe
wrangler r2 object put astravia-downloads/plugins/astravia-plugin-1.0.0.zip \
  --file=./dist/astravia-plugin-1.0.0.zip
```

 发布流程可把上传命令并入仓库现有发版脚本（[desktop-releases.md](../desktop-releases.md)）。

## 8. 验证清单（全部通过才算完成）

| 检查项 | 命令/方法 | 期望结果 |
|---|---|---|
| NS 已切换 | `dig NS astravia.dev +short` | 返回 Cloudflare 的两个 NS |
| 官网解析 | `dig www.astravia.dev +short` | 返回 Cloudflare CDN IP（非空） |
| 官网可访问 | 浏览器打开 `https://www.astravia.dev` | 页面正常、锁形 HTTPS、无证书错误（部署 Pages 并绑定域名前打不开属正常，源站无内容） |
| 注册局层确认 | `curl https://rdap.org/domain/astravia.dev` 看 nameservers | 显示 elisabeth/jaime.ns.cloudflare.com |
| 根域访问 | 浏览器打开 `https://astravia.dev` | 显示官网（可选配置：重定向到 www 统一域名；不配则两个地址各自独立可访问） |

| 插件直链（已上线） | 浏览器打开 `https://dl.astravia.dev/plugins/web-element-picker-extension-0.3.2.zip`（浏览器扩展）/ `.../web-element-picker-builtin-0.2.4.zip`（内置插件） | 200、`application/zip`（28057 / 155557 字节，2026-08-30 实测通过，`dl` 与 `pub` 域名一致） |
| 下载直链 | 浏览器打开 `https://dl.astravia.dev/app/v<版本>/astravia-<版本>-mac.dmg` | 200 可下载（路径以实际版本为准，见 [installer-r2-distribution.md](installer-r2-distribution.md)） |
| 更新元数据 | 浏览器打开 `https://dl.astravia.dev/app/v<版本>/latest.yml` | 返回 YAML，version 与发版版本一致 |
| 跨网络验证 | 手机流量（非 Wi-Fi）再访问一次 | 正常（排除本机 DNS 缓存假象） |

## 9. 免费额度参考

| 资源 | 免费额度（官方定价页） |
|---|---|
| DNS / CDN / TLS | 无限 |
| Pages | 每站点 20,000 文件、每月 500 次构建、单次构建 20 分钟 |
| R2 存储 | 10 GB 存储、每月 100 万次 A 类操作、1000 万次 B 类操作 |
| R2 出网流量 | **免费**（不按 GB 收费） |

来源：[Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/) 与 [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)。

## 10. 常见问题

| 问题 | 回答 |
|---|---|
| NS 多久生效？ | 通常几分钟，最长 48 小时；Cloudflare 状态变 Active 即为生效 |
| 构建失败？ | 查 Pages 项目 → Deployments → 点开失败记录看构建日志，通常是 Build command / output directory 配错 |
| R2 单文件大小限制？ | 单对象上限 5 TB，安装包无压力 |
| 国内访问速度？ | Cloudflare CDN 大部分时段可用，R2 直链速度一般但优于 GitHub；无 SLA，极端情况需 DoH |
| 免费额度够吗？ | 0 用户起步完全够；若未来下载量大，R2 出网免费、存储按量计费也很便宜 |
 | 与自动更新的衔接？ | Windows 更新源可指向 R2 或 GitHub Releases（见 [windows-auto-update.md](../../desktop/windows-auto-update.md)）；macOS 走 Squirrel.Mac（见 [macos-auto-update.md](../../desktop/macos-auto-update.md)）；R2 同时承载安装包与 `latest*.yml` 元数据一套两用 |
| 添加子域名报 "No zones match"？ | 用错入口：要用 Custom Domains and Routes 区块的 **+ Add Domain**（弹窗 Subdomain 填 www），不要用 Worker URL 旁的 Connect domain（见第 5 节） |
| www 访问报 522？ | 手动在 DNS 加 CNAME 指向 workers.dev 的旧式做法会导致回源失败 522；改用官方 + Add Domain 绑定，自动建记录与证书（见第 5 节 5.2 第 4 条） |
| 根域打不开？ | 检查 DNS 里根域记录是否还在（Type Worker/Pages 或 A 记录 Proxied）；添加子域后可能受影响，缺失则补 A 记录 `@`（见第 5 节 5.2 第 5 条） |
| 电脑能开官网，手机打不开 www？ | DNS 传播/缓存延迟：www 记录刚生效，运营商/路由器/手机缓存了旧的失败结果。依次试：浏览器无痕 → 飞行模式开关 → Wi-Fi↔4G/5G 切换 → 重启路由器 → 重启手机；`https://1.1.1.1/dns?name=www.astravia.dev` 可在线确认是否已生效（见第 5 节 5.2 第 8 条）。新记录传播几分钟到 48 小时属正常，不要重复绑定 |

| R2 激活需要付款方式，没有怎么办？ | 免费额度内 $0 不扣款，只是登记。激活不过可改用 GitHub Releases 或 Backblaze B2（见第 6.1 节备选方案） |
 | 用 GitHub Releases 代替 R2 会影响自动更新吗？ | Windows 更新源本就可选 GitHub Releases（见 [windows-auto-update.md](../../desktop/windows-auto-update.md)），`latest.yml` 照常可用；国内下载速度一般 |
