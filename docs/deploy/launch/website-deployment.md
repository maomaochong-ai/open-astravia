# 个人开发者域名购买与官网部署方案（免备案）

> 适用范围：中国大陆个人开发者，无企业主体、无法办理 ICP 备案。
> 目标：购买域名 → 部署官网 → 对外分发跨平台桌面应用（macOS / Windows / Linux）供外部用户下载。
> 调研基准日：2026-08。价格均为美元（USD）或已注明，随时变动，以官网结算为准。

---

## 1. 结论速览（TL;DR）

| 事项 | 推荐 | 一句话理由 |
|---|---|---|
| 域名注册商 | **Dynadot**（首选）/ **Namesilo**（备选） | 两者都官方/实测支持支付宝，Dynadot 还支持银联；无需实名 |
| 域名后缀 | **.com** | 认知度最高、无实名要求、续费稳定 |
| DNS / CDN | **Cloudflare**（免费） | 免费 DNS + CDN + Pages 托管 + R2 存储一条龙 |
| 官网托管 | **Cloudflare Pages**（免费）或 **Vercel Hobby**（免费） | 均免备案、免费 TLS、国内可达性较好 |
| 安装包分发 | **Cloudflare R2 公共桶**（出网免费）+ 保留 GitHub Releases | R2 免费 10GB 存储 + 免费出网，更新链路与现有 electron-updater 兼容 |
| 合规路径 | 境外注册商 + 境外托管，**全程免 ICP 备案、免实名** | 备案与服务器所在地绑定，桌面应用不在 App 备案范围 |

年度成本估算（0 用户规模）：**域名 $11~13 + （可选）Apple 开发者账号 $99**，官网与下载存储均为 0 元。详见[第 8 节](#8-费用汇总)。

---

## 2. 背景与合规约束（为什么可以免备案）

### 2.1 ICP 备案义务与服务器所在地绑定

- 依据《非经营性互联网信息服务备案管理办法》（信息产业部令第 33 号），需备案的是"在中华人民共和国境内提供非经营性互联网信息服务"的情形。实践中主管部门以**服务器物理位置**为判断标准：服务器在中国大陆境内必须备案，服务器在境外（含港澳台）无需 ICP 备案。
- 佐证：阿里云官方备案文档明确"通过阿里云 ICP 备案，首先需要购买阿里云**在中国内地**的服务器"（来源：[阿里云·备案前期准备工作](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/overview)）。即：备案是一个绑定境内服务器/服务码的动作，不备案时只要不把服务架在境内主机上即可。
- 结论：**域名在境外注册商注册 + 网站托管在境外（Cloudflare / Vercel / Netlify 等）→ 无需 ICP 备案**。这是个人开发者常见的免备案路径（社区方案如 [Porkbun + Vercel + Cloudflare 免备案部署](https://juejin.cn/post/7378143151888482338)）。

### 2.2 域名实名认证

- 依据《互联网域名管理办法》（工业和信息化部令第 43 号，2017），境内注册服务机构（阿里云、腾讯云等）注册域名必须实名认证（个人需身份证信息），且实名信息会进入 WHOIS 可查（虽然后续可隐藏）。
- 该办法约束的是**在境内开展域名服务的机构**；在境外注册商（Dynadot / Namesilo / Namecheap / Porkbun / Cloudflare Registrar 等）注册 `.com` 等境外后缀域名，**不适用境内实名要求**，只需提供真实邮箱等联系方式并完成 ICANN 要求的 WHOIS 邮箱验证（注册后 15 天内，否则域名暂停解析）。
- 结论：**境外注册商注册 .com → 无需实名认证**（Namesilo 教程明确"无需实名认证即可购买和使用"，见[来源](https://blog.naibabiji.com/tutorial/namesilo-zhu-ce-jiao-cheng.html)）。

### 2.3 App 备案（移动应用）与桌面应用

- 工信部 2023 年发布《关于开展移动互联网应用程序备案工作的通知》（工信部信管〔2023〕105 号），要求 2023 年 9 月起新上架、2024 年 4 月起所有移动应用（App）在**境内应用商店**上架前完成备案，App Store 中国区同样执行。
- **桌面应用（macOS / Windows / Linux 桌面程序）不属于"移动互联网应用程序"，不在 App 备案范围内**；通过自有官网直接分发安装包无需任何备案。
- 若未来要上架移动端（iOS App Store 中国大陆区 / 国内安卓商店），才需要走 App 备案（个人开发者可以备案，但需先有已备案网站或按流程办理）；**上架非大陆区商店（如美区 App Store）可完全避开**。本方案不涉及移动端上架。

---

## 3. 域名注册商对比

### 3.1 对比表（重点：中国支付方式支持）

| 注册商 | 支付宝 | 微信 | 银联 | 信用卡 | PayPal | .com 首年参考价 | 无需实名 | 来源 |
|---|---|---|---|---|---|---|---|---|
| **Dynadot**（首选） | ✅ 官方确认 | ❌ | ✅ 官方确认 | ✅ V/MC/Amex/Discover/JCB/Diners | ✅ | 约 $11（官网价格页为准） | ✅ | [官方支付方式页](https://www.dynadot.com/payment-options) |
| **Namesilo** | ✅ 实测（二手） | ❌ | ❌ 未确认 | ✅ | ✅ | 约 $9~12 | ✅ | [Namesilo 教程](https://blog.naibabiji.com/tutorial/namesilo-zhu-ce-jiao-cheng.html) |
| **Namecheap** | ❌ 未列 | ❌ | ✅ 官方确认 | ✅ | ✅ | 约 $10~11（官网为准） | ✅ | [官方支付文章](https://www.namecheap.com/support/knowledgebase/article.aspx/35/7/what-payment-methods-do-you-accept-for-domain-registrations/) |
| **Porkbun** | ⚠️ 未确认 | ❌ | ❌ 未确认 | ✅ | ✅ | **$11.08**（官网首页价） | ✅ | [Porkbun 官网](https://porkbun.com/) |
| **Cloudflare Registrar** | ❌ | ❌ | ❌ | ✅ 仅卡 | ❌ | 约 $10.44（成本价） | ✅ | [Cloudflare Registrar 文档](https://developers.cloudflare.com/registrar/) |
| **GoDaddy** | ⚠️ 不稳定（曾支持） | ❌ | ❌ 未确认 | ✅ | ✅ | 约 $12~15 | ✅ | 二手来源（搜狗检索），需确认 |
| **Spaceship** | ⚠️ 二手来源 | ❌ | ❌ | ✅ | ✅ | 约 $9~12 | ✅ | 二手来源，需确认 |
| **Hostinger** | ⚠️ 二手来源 | ❌ | ❌ | ✅ | ✅ | 约 $11~13 | ✅ | 二手来源，需确认 |
| 阿里云 / 腾讯云（对照组） | ✅ 原生 | ✅ 原生 | ✅ 原生 | ✅ | ❌ | 约 ¥80~100/年（促销更低） | ❌ **必须实名** | [阿里云备案文档](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/overview) |

说明：

- ✅ = 官方页面或可靠来源确认；❌ = 官方页面明确未提供；⚠️ = 仅有二手来源（中文教程/问答），官方页面未直接验证，**购买前请人工确认**。
- **Dynadot 是本方案首选**：官方支付页明确列出 Alipay 与 Union Pay 两种中国支付方式（人民币结算，支付宝单笔上限 RMB 30,000），并有简体中文界面，无需实名。这是所有候选里中国支付支持最明确的一家（一手来源）。
- **Namecheap 注意**：官方支付文章列出的直接支付方式包含 **UnionPay（银联）**，但**未列出支付宝**——有银联卡可直接用，无银联卡需走 PayPal。
- **Porkbun** .com 首年 $11.08 是候选最低价，但官方 KB 页面为 JS 渲染，脚本无法确认其是否支持支付宝/银联；其结账通常需要信用卡或 PayPal，国内用户若没有双币卡可能受阻（社区多用它 + 双币卡）。若你有 Visa/Mastercard 双币卡，Porkbun 性价比最高。
- 对照组：境内注册商（阿里云/腾讯云）支付方便、价格促销多，但**必须实名**，且域名若解析到境内服务器必须备案；对"免备案"路线不推荐。
- 币种：以上 .com 价格多为首年促销价；续费价普遍更高（见第 4 节）。具体数字均以官网实时价格页为准（部分价格页为 JS 渲染，脚本无法抓取数值，已标注）。

### 3.2 注册商详情

**Dynadot（首选）**

- 官方支付方式页明确列出：**Alipay（支付宝，人民币结算，单笔上限 ¥30,000）、Union Pay（银联，人民币结算）、PayPal、信用卡（Visa / Mastercard / Amex / Discover / JCB / Diners）**；货币选择支持 CNY（仅限支付宝与银联）。（来源：[Dynadot Payment Options](https://www.dynadot.com/payment-options)）
- 支持简体中文界面，管理后台成熟，域名转出无阻碍。
- .com 价格页：[Dynadot 域名价格](https://www.dynadot.com/domain/prices)（表格为 JS 渲染，脚本抓不到数值，结算时可见）。

**Namesilo（备选）**

- ICANN 认证注册商，实测（中文教程）支持支付宝结账、免费 WHOIS 隐私保护、无需实名认证。（来源：[奶爸建站笔记 2026-03](https://blog.naibabiji.com/tutorial/namesilo-zhu-ce-jiao-cheng.html)）
- 注意：教程提示"自动续费对支付宝付款无效"，需手动续费并注意到期提醒；官网国内直连可能不稳定（教程建议代理访问）。
- 官网本机抓取被 403 拦截，支付宝支持为二手来源，建议注册前人工确认结账页面选项。

**Namecheap**

- 官方支付文章确认直接支付支持 Visa / MasterCard / Discover / Amex / Diners / JCB / **UnionPay**，以及 PayPal 与加密货币；**未列出支付宝**。（来源：[Namecheap KB 支付文章](https://www.namecheap.com/support/knowledgebase/article.aspx/35/7/what-payment-methods-do-you-accept-for-domain-registrations/)）
- 币种选择支持 China Yuan RMB。有银联卡则可用，否则走 PayPal。

**Cloudflare Registrar**

- 官方文档："按成本价购买和续费域名，无加价（no markup）"，自动续费默认开启，续费仍按注册局成本价。（来源：[Cloudflare Registrar](https://developers.cloudflare.com/registrar/)）
- 支付方式仅信用卡/借记卡（文档未列出支付宝/微信/银联），国内用户需双币卡或境外卡；注册时要求把 DNS 托管到 Cloudflare。适合已有双币卡、想把域名成本压到最低的人（.com 成本价约 $10.44/年，远低于多数注册商续费价）。
- 不推荐作为新手首选（支付门槛 + 必须托管 DNS 到 Cloudflare），可作为进阶选项。

---

## 4. 域名选择与费用

### 4.1 后缀建议

| 后缀 | 建议 | 理由 |
|---|---|---|
| **.com** | ✅ 首选 | 认知度最高、注册续费稳定、境外注册商注册无实名要求、转出容易 |
| .net / .org | 备选 | 若 .com 被占，.org 适合开源项目形象 |
| .dev / .app | 备选 | Google 管理，**强制 HTTPS**，适合纯官网；价格较高 |
| .cn | ❌ 不建议 | 需实名，且与境内监管绑定 |
| 小众新顶级域 | ❌ 不建议 | 续费波动大、部分对境内访问不友好 |

### 4.2 费用构成（以 .com 为例）

| 项 | 说明 | 参考价（2026-08） |
|---|---|---|
| 首年注册 | 各注册商促销价不同 | $9~13 |
| 续费 | 多数注册商续费高于首年（促销仅限首年） | $12~18 |
| Cloudflare 续费 | 注册局成本价 + ICANN 费，无加价 | 约 $10.44/年 |
| WHOIS 隐私保护 | 境外主流注册商 .com 普遍免费 | $0 |
| ICANN 验证 | 注册后 15 天内验证 WHOIS 邮箱，免费 | $0 |

要点：

- 首年便宜不等于续费便宜：Porkbun / Namecheap 首年促销价很有吸引力，续费会回到 $13+。**长期看 Cloudflare Registrar 成本价续费最省**（但需要双币卡）。
- 自动续费：境外注册商默认开启自动续费；若用支付宝付款，部分注册商（如 Namesilo）无法自动扣款，**务必手动设置到期提醒**，域名过期有 30 天宽限期，但过期后可能被抢注。
- WHOIS 隐私保护：注册时默认开启（免费），避免真实邮箱/姓名暴露；境外注册商不受境内实名要求约束，个人隐私风险低。
- 注册信息：用真实邮箱（收验证邮件），姓名/地址可填拼音。

---

## 5. 官网托管对比

### 5.1 对比表（免费档）

| 平台 | 免费额度 | 国内可达性 | 备注 |
|---|---|---|---|
| **Cloudflare Pages** | 20,000 文件/站点、500 builds/月、自定义域名 100 个 | 较好（Cloudflare 国内节点多） | 与 R2、DNS、CDN 同生态，一条龙；静态站免费 [来源](https://developers.cloudflare.com/pages/platform/limits/) |
| **Vercel Hobby** | 100 GB 流量/月、100 次部署/天、200 项目 | 较好（边缘网络） | 静态站/框架站免费；函数时长 Hobby 上限 60s [来源](https://vercel.com/docs/limits) |
| **Netlify Free** | 300 积分/月（1 次生产部署约 15 积分，带宽 20 积分/GB） | 一般 | 积分制硬限额，不超额收费 [来源](https://www.netlify.com/pricing/) |
| **GitHub Pages** | 站点 ≤1GB、软限额 100GB 带宽/月、10 builds/h | 一般（github.io 国内时好时坏） | ⚠️ **条款禁止商业/SaaS 用途**，官网做软件分发有违规风险，不建议作主站 [来源](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |

### 5.2 平台说明

**Cloudflare Pages（推荐官网载体）**

- 免费档：每站点最多 20,000 文件、每月 500 次构建、每次构建超时 20 分钟、每项目最多 100 个自定义域名。（来源：[Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/)）
- 免费自动 HTTPS、全球 CDN、与 Cloudflare DNS 一键绑定自定义域名。
- 适合 Astravia 官网这种纯静态展示页（项目介绍 + 下载按钮 + 文档链接）。部署方式：连接 GitHub 仓库，推 `main` 即自动构建发布。

**Vercel Hobby（备选官网载体）**

- 免费档：100 GB 流量/月、每天 100 次部署、200 个项目、源文件上传上限 100MB。（来源：[Vercel Limits](https://vercel.com/docs/limits)）
- 对静态官网来说 100GB/月流量非常充裕；同样免费 TLS + 自定义域名。
- 若官网将来要做成 Next.js 等框架站，Vercel 更顺手；纯静态则与 Cloudflare 无本质差别。

**Netlify Free**

- 免费档为积分制：每月 300 积分；1 次生产部署约 15 积分、带宽 20 积分/GB、Web 请求 2 积分/万次。（来源：[Netlify Pricing](https://www.netlify.com/pricing/)）
- 硬限额不超额收费，但 300 积分只够约 20 次生产部署/月或 15GB 带宽/月，频繁发版会很快耗尽；适合低频静态站，不推荐作为活跃官网主载体。

**GitHub Pages（不建议作主站）**

- 官方条款明确："GitHub Pages 不允许用作免费 Web 托管来运营在线业务、电商或**以商业软件即服务（SaaS）为主要目的**的网站"。（来源：[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)）
- 官网 + 软件下载分发属于典型的商业用途（即使应用本身开源免费），有被停用风险；**不要用 GitHub Pages 当主站**。可作为镜像/文档站备用。

---

## 6. 推荐架构

```
境外注册商注册域名（Dynadot / Namesilo，支付宝付款，无需实名）
        │
        ▼
Cloudflare（免费账户）
├── DNS 托管（nameserver 指向 Cloudflare）
├── CDN / SSL（自动）
├── Pages：官网静态站（连接 GitHub 仓库自动发布）
│     └── www.astravia.example  →  Cloudflare Pages
├── R2 对象存储（公共桶，免费 10GB + 免费出网）
│     ├── download/astravia-<ver>-mac.dmg
│     ├── download/astravia-<ver>-win.exe
│     └── download/astravia-<ver>-linux.AppImage
└── 更新源（可选）：
      ├── 沿用现有 electron-updater 链路
      │     ├── Windows: R2 / GitHub Releases（见 docs/desktop/windows-auto-update.md）
      │     └── macOS: Squirrel.Mac（见 docs/desktop/macos-auto-update.md）
      └── 官网下载按钮直链 R2 公共桶 URL
```

要点：

1. **域名**：在 Dynadot（或 Namesilo）注册 `.com`，支付宝付款，免费 WHOIS 隐私。
2. **DNS**：把域名的 nameserver 改为 Cloudflare 分配的 NS（免费计划即可）；DNS 解析在国内一般无污染问题（.com 在境外注册 + Cloudflare 权威 DNS，被墙概率低；极端情况下可用 DoH）。
3. **官网**：源码放 GitHub 仓库 → Cloudflare Pages 连接该仓库，`main` 分支自动构建；绑定 `www.<domain>` 与 `<domain>`（裸域 301 到 www 或反之）。
4. **下载分发**：安装包上传到 Cloudflare R2 公共桶（免费 10GB 存储、**出网流量免费**——这是 R2 相对其他对象存储的最大优势，来源：[R2 Pricing](https://developers.cloudflare.com/r2/pricing/)）；官网下载按钮直链 `pub-xxxx.r2.dev` 或绑定自定义域名 `dl.<domain>`（更专业、可加 CDN 缓存）。**不要**用 GitHub Releases 直链做大文件下载（有 2GB 单文件上限、且国内访问 GitHub 不稳）；GitHub Releases 保留作为自动更新源与源码发布。
 5. **自动更新**：沿用仓库现有 electron-updater 链路（Windows 走 R2 + GitHub Releases 更新源，macOS 走 Squirrel.Mac），详见 [desktop-releases.md](../desktop-releases.md) 与 [windows-auto-update.md](../../desktop/windows-auto-update.md)、[macos-auto-update.md](../../desktop/macos-auto-update.md)。R2 公共桶同时承载安装包与更新元数据，一套存储两用。

---

## 7. 应用下载分发

### 7.1 macOS

- **必须做 Developer ID 签名 + 公证**，否则用户首次打开会提示"已损坏/无法验证开发者"，劝退大量用户。
- **个人 Apple 开发者账号即可**（$99/年），无需 D-U-N-S 企业编号——Apple 官方对比页明确：只有 Organization（企业/机构）需要提供 D-U-N-S；**Individual（个人）注册不需要**，且付费会员包含 "Notarization & Developer ID for Mac apps"。（来源：[Apple 会员类型对比](https://developer.apple.com/support/compare-memberships/)）
 - 仓库现有 [apple-code-signing.md](../apple-code-signing.md) 按公司主体撰写（含 D-U-N-S 申请），**个人账号路径可去掉 D-U-N-S 部分直接复用**：申请 Developer ID Application 证书 → 配置 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_API_*` → 构建自动签名 + 公证。
 - 分发：DMG 放 R2 公共桶；自动更新沿用 Squirrel.Mac（[macos-auto-update.md](../../desktop/macos-auto-update.md)）。

### 7.2 Windows

- **SmartScreen 警告**：未签名的 EXE 会触发"Windows 已保护你的电脑"。两个选择：
  - **不签名**（个人开发者常见起点）：用户需点"更多信息 → 仍要运行"，教程页说明即可，成本 0。
  - **代码签名证书**：OV 证书约 $200~300/年（需企业资质，个人买不了）；**Certum 提供面向开源项目的免费 Open Source Code Signing**（Astravia 为 Apache-2.0 开源项目，符合申请条件，需进一步确认当前政策）。签名后 SmartScreen 仍可能短暂警告（信誉积累），但会逐步消失。
 - 分发：EXE 放 R2 公共桶；自动更新沿用 electron-updater + R2/GitHub 更新源（[windows-auto-update.md](../../desktop/windows-auto-update.md)）。

### 7.3 Linux

- 分发 AppImage / .deb / .rpm 到 R2 公共桶；无签名强制要求（社区信任模型），可在官网放 sha256 校验和。
- 可选：发布到 Flathub / Snap Store 增加曝光（非必需）。

### 7.4 移动端（说明，不在本方案范围）

- 桌面应用不在 App 备案范围。若未来做移动端：上架**非大陆区商店**（美区 App Store、Google Play）无需中国 App 备案；上架**中国区**（App Store 中国大陆区、国内安卓商店）需先完成 App 备案（工信部 105 号文，个人可办理）。建议个人开发者优先走非大陆区渠道。

---

## 8. 费用汇总

| 项目 | 费用（2026-08 估算） | 说明 |
|---|---|---|
| 域名 .com 首年 | $9~13 一次性 | Dynadot / Namesilo / Porkbun 任选 |
| 域名 .com 续费 | $12~18/年 | Cloudflare Registrar 约 $10.44/年（需双币卡） |
| WHOIS 隐私 | $0 | 境外主流注册商免费 |
| Cloudflare（DNS/CDN/Pages/R2） | $0 | 免费计划；R2 免费 10GB 存储 + 免费出网 |
| Vercel / Netlify | $0 | 免费档够用（仅作备选） |
| Apple 开发者账号 | $99/年（可选但强烈建议） | 个人账号即可，含公证 |
| Windows 代码签名 | $0（暂不签名）或 免费 Certum（需确认）或 $200+/年 | 见 7.2 |
| **合计（推荐组合）** | **首年约 $110~112（含 Apple 账号）或 $11~13（仅域名）** | 后续每年约 $111~117 |

> 注：Apple 账号不是域名方案的必需项，但 macOS 分发不做签名公证基本不可用，建议纳入预算。

---

## 9. 分步实施计划

1. **注册域名（30 分钟）**
   - 在 Dynadot 注册账号 → 搜索想要的 `.com`（如 astravia.app 已被占则试 astravia.dev 等）→ 结算选 **支付宝** → 完成注册。
   - 开启免费 WHOIS 隐私保护；记下注册商账号 + 开启两步验证。
2. **验证 ICANN 邮箱（5 分钟）**
   - 查收注册商发来的验证邮件，15 天内点击验证，否则域名会被暂停。
3. **接入 Cloudflare（20 分钟）**
   - 注册 Cloudflare 免费账号 → 添加域名 → 按提示把注册商处域名 NS 改为 Cloudflare 分配的 NS → 等 DNS 生效（几分钟到几小时）。
4. **部署官网（1~2 小时）**
   - 建 `astravia-website` GitHub 仓库（官网源码，可基于现有 docs/assets 的 logo/banner 素材）。
    - Cloudflare Pages → Create project → 连接该仓库 → 构建命令 `cd website && bun install && bun run build`、输出目录 `website/dist` → 绑定自定义域名 `www.<domain>` 与裸域（设 301）。官网源码在仓库 `website/` 目录（Vite + TypeScript，见 [website/README.md](../../../website/README.md)）。
5. **配置 R2 下载桶（30 分钟）**
   - Cloudflare → R2 → 创建公共桶 `astravia-downloads` → 上传 DMG / EXE / AppImage，并按版本建目录（`v0.x.y/`）。
   - 绑定 `dl.<domain>` 自定义域名指向该桶（R2 公共桶支持自定义域名 + 自动缓存）。
6. **官网挂下载按钮**
   - 官网下载区：macOS / Windows / Linux 三个按钮，直链 R2 对应文件；Linux 附 sha256。
   - 加"自动更新"说明，指向现有 electron-updater 配置。
7. **macOS 签名公证（首次 1~2 天，含 Apple 审核）**
    - 申请个人 Apple 开发者账号（$99）→ 创建 Developer ID Application 证书 → 配置环境变量 → 构建出签名+公证的 DMG → 按 [apple-code-signing.md](../apple-code-signing.md) 第 5 节验证（个人账号跳过 D-U-N-S 步骤）。
8. **发布与回归**
    - 跑一次完整发版流程，验证官网可访问、下载直链可下、Windows 更新源正常（[desktop-releases.md](../desktop-releases.md)）。
   - 用**另一台没装过开发者证书的机器**实测下载安装三平台产物。

---

## 10. 风险与注意事项

- **国内访问稳定性**：境外托管 + 境外 CDN 在国内没有 SLA 承诺。Cloudflare 免费 CDN 大部分时段可用，但个别地区/时段可能丢包或需要 DoH 才能正确解析；**不要**指望与国内云同等体验。R2 公共桶直链国内下载速度一般（优于 GitHub），可接受。
- **支付宝付款的续费**：部分注册商用支付宝付款后**无法自动续费**（Namesilo 明确如此），请设置手动续费提醒；到期未续有 30 天宽限期，之后域名释放可被抢注。
- **价格变化**：首年促销价与续费价差异大，注册时看清"renewal price"；注册局批发价上调会传导到续费（.com 近年多次上调）。
- **注册商锁定**：境外主流注册商（Dynadot / Namesilo / Namecheap / Porkbun / Cloudflare）转出政策宽松（60 天后可转、免费获取转移码）；避免使用有隐性锁定条款的注册商。Cloudflare Registrar 要求 NS 托管在 Cloudflare，转出需先解除。
- **GitHub Pages 条款**：不要用 GitHub Pages 承载软件下载官网（商业用途违规，[官方限制页](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)）；仅作镜像。
- **证书/签名**：个人 Apple 账号做的公证完全够用；Windows 若跳过代码签名，SmartScreen 警告是预期内的，官网教程写明"点击更多信息→仍要运行"。
- **合规边界**：本方案成立的前提是服务（官网、下载）全部架在境外。若未来把数据库/服务部署回境内服务器，或域名解析指向境内主机，则必须补 ICP 备案。境内注册商注册的域名与境内业务是另一条路线，与本方案互斥。
- **需进一步确认项**（写文档时未能从官方页面直接验证）：
  - Porkbun / GoDaddy / Spaceship / Hostinger 的支付宝支持（本机抓取被反爬拦截，社区信息不一致）。
  - Namesilo 官网支付页面当前是否仍提供支付宝选项（官方站 403，教程为 2026-03 二手来源）。
  - GitHub Releases 单文件 2GB 上限的官方文档页（本机 docs.github.com 页面路径变动，未验证）。
  - Certum 开源项目免费代码签名证书的当前政策。

---

## 11. 参考来源

**注册商（一手）**

- Dynadot 支付方式：[https://www.dynadot.com/payment-options](https://www.dynadot.com/payment-options)（Alipay / Union Pay / PayPal / 信用卡，CNY 仅限支付宝与银联）
- Dynadot 域名价格：[https://www.dynadot.com/domain/prices](https://www.dynadot.com/domain/prices)（JS 渲染，数值以结算为准）
- Namecheap 支付方式（官方文章）：[https://www.namecheap.com/support/knowledgebase/article.aspx/35/7/](https://www.namecheap.com/support/knowledgebase/article.aspx/35/7/what-payment-methods-do-you-accept-for-domain-registrations/)（含 UnionPay；未列支付宝）
- Porkbun 官网（.COM from $11.08）：[https://porkbun.com/](https://porkbun.com/)
- Cloudflare Registrar 文档（成本价、自动续费、卡支付）：[https://developers.cloudflare.com/registrar/](https://developers.cloudflare.com/registrar/)

**注册商（二手，需确认）**

- Namesilo 支付宝/免实名教程（2026-03）：[https://blog.naibabiji.com/tutorial/namesilo-zhu-ce-jiao-cheng.html](https://blog.naibabiji.com/tutorial/namesilo-zhu-ce-jiao-cheng.html)

**托管 / 存储（一手）**

- Cloudflare Pages 限制：[https://developers.cloudflare.com/pages/platform/limits/](https://developers.cloudflare.com/pages/platform/limits/)
- Cloudflare R2 定价（免费 10GB + 免费出网）：[https://developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/)
- Vercel 限制（Hobby 100GB 流量）：[https://vercel.com/docs/limits](https://vercel.com/docs/limits)
- Netlify 定价（积分制）：[https://www.netlify.com/pricing/](https://www.netlify.com/pricing/)
- GitHub Pages 限制与使用条款：[https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

**合规（官方）**

- 阿里云 ICP 备案文档（备案需境内服务器）：[https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/overview](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/overview)
- 《非经营性互联网信息服务备案管理办法》（信息产业部令第 33 号）——经检索确认存在，原文链接以 gov.cn 发布页为准
- 《互联网域名管理办法》（工业和信息化部令第 43 号）——经检索确认存在，原文链接以 gov.cn 发布页为准
- 《关于开展移动互联网应用程序备案工作的通知》（工信部信管〔2023〕105 号）——经检索确认存在（标题检索来源：搜狗搜索）

**其他**

- Apple 开发者会员类型对比（个人 $99 无需 D-U-N-S、含公证）：[https://developer.apple.com/support/compare-memberships/](https://developer.apple.com/support/compare-memberships/)
- 免备案部署社区方案（Porkbun + Vercel + Cloudflare）：[https://juejin.cn/post/7378143151888482338](https://juejin.cn/post/7378143151888482338)

**仓库内部文档（分发链路）**

 - [desktop-releases.md](../desktop-releases.md)（发布与自动更新总览）
 - [apple-code-signing.md](../apple-code-signing.md)（macOS 签名/公证手册，个人账号可复用，去掉 D-U-N-S 步骤）
 - [windows-auto-update.md](../../desktop/windows-auto-update.md) / [macos-auto-update.md](../../desktop/macos-auto-update.md)（自动更新详情）
