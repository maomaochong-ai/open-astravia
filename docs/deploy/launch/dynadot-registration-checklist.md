# Dynadot 注册域名操作清单（astravia.dev）

> 配套文档：[website-deployment.md](website-deployment.md)（整体方案）。
> 本文是照做式清单：准备 → 注册账号 → 搜索域名 → 结账 → 验证 → 加固。
> 界面文案以 Dynadot 实际页面为准（官网右上角可切换中文界面）。
> 域名可用性为本机 RDAP 权威查询结果（2026-08-29）。

---

## 0. 域名结论（先看这个）

| 域名 | 状态 | 结论 |
|---|---|---|
| astravia.com | ❌ 已注册 | 放弃 |
| **astravia.dev** | ✅ 未注册 | **注册它** |
| astravia.app | ❌ 已注册 | 放弃 |

备注：`.dev` 由 Google 管理，**强制 HTTPS**（只能 https 访问），适合官网；价格略高于 .com（以结算页为准）。

## 1. 注册前准备

| 项 | 要求 |
|---|---|
| 邮箱 | 常用国际邮箱（Gmail / Outlook 优先），后续收 ICANN 验证邮件与账单 |
| 支付 | 支付宝（余额或已绑卡）；也可选银联 / 信用卡 / PayPal |
| 注册人信息 | 拼音姓名 + 拼音地址（填法见第 5 节），无需实名认证、无需身份证 |
| 预算 | 首年约 $12~15（.dev，以页面为准），支付宝按人民币结算 |

## 2. 注册 Dynadot 账号

1. 打开 [dynadot.com](https://www.dynadot.com/)。
2. 右上角语言菜单切换**中文**（可选，不影响功能）。
3. 点"注册 / Sign Up"：邮箱 + 密码（建议用密码管理器生成）。
4. 查收验证邮件并点击确认链接，然后登录。

## 3. 搜索并加入购物车

1. 首页搜索框输入 `astravia`，回车。
2. 在结果列表找到 `.dev` 一行，确认状态为"可注册"且显示价格。
3. 核对两列价格：
   - **Registration（首年）**：本次支付金额。
   - **Renewal（续费）**：之后每年费用——确认可接受（.dev 续费一般高于首年促销价）。
4. 点 **Add to Cart / 加入购物车**。

## 4. 结账（关键步骤）

1. 进入购物车，**年限选 1 年**（先注册一年，熟悉流程后再决定是否多付几年锁价）。
2. 确认 **WHOIS 隐私保护（Privacy）默认开启且免费**；若页面没有明确显示，找并勾选它（防止个人邮箱/姓名公开）。
3. 进入 Checkout，填写注册人信息（Registrant），模板见第 5 节。
4. 支付方式选 **Alipay（支付宝）**。
5. 确认金额后提交，页面跳转支付宝：扫码或登录付款。
6. 付款成功后回到 Dynadot，域名即注册完成。

## 5. 注册人信息填写模板（全部替换为你自己的）

| 字段 | 填写示例 | 说明 |
|---|---|---|
| First Name（名） | GEYUE | 拼音，可连写 |
| Last Name（姓） | ZHU | 拼音大写 |
| Email | 你的真实邮箱 | 必须真实，ICANN 验证 + 到期提醒都发这里 |
| Address | NO.88 XXX ROAD, XXX DISTRICT | 拼音门牌号+路名+区 |
| City | SHENZHEN | 城市拼音大写 |
| State / Province | GUANGDONG | 省拼音大写 |
| Postal Code | 518000 | 邮编 |
| Country | CHINA / CN | 选中国 |
| Phone | +86 138 0000 0000 | 格式 +86 后接手机号 |

规则：全部用拼音（不用中文）、全部大写可读性更好；信息与身份无关，无需实名认证。
规则：全部用拼音（不用中文）、全部大写可读性更好；信息与身份无关，无需实名认证。

### 5.1 美国地址模板（可选）

如果你打算用美国地址信息注册，按美国格式填写（以下为**格式示例**，地址为占位符，**不是建议填写的真实地址**，全部替换为你自己的信息）：

| 字段 | 填写示例 | 美国格式规则 |
|---|---|---|
| First Name（名） | GEYUE | 与护照/身份证拼音一致 |
| Last Name（姓） | ZHU | 与护照/身份证拼音一致 |
| Email | 你的真实邮箱 | 必须真实，ICANN 验证 + 到期提醒都发这里 |
| Address Line 1 | 1234 MARKET STREET, SUITE 501 | **门牌号在前、街名在后**；公寓/套房用逗号接在后面，或放 Address Line 2 |
| Address Line 2 | （可留空） | 可选：Apt / Suite / Building 号 |
| City | SAN FRANCISCO | 城市名 |
| State / Province | CA | **两字母州缩写**（CA 加利福尼亚、NY 纽约、TX 得克萨斯、WA 华盛顿州等） |
| ZIP / Postal Code | 94103 | 美国 5 位邮编（或 ZIP+4 如 94103-1234），**不是 +86 邮编** |
| Country | UNITED STATES / US | 选美国 |
| Phone | +1 415 000 0000 | 美国格式：+1 + 10 位电话 |

美国州缩写速查（常用）：CA 加州 / NY 纽约 / WA 华盛顿州 / TX 得州 / FL 佛州 / IL 伊利诺伊 / MA 马萨诸塞 / NJ 新泽西 / PA 宾州 / VA 弗吉尼亚 / DC 华盛顿特区；其余州缩写均可网上查「US state abbreviations」。

### 5.2 关于美国地址的重要提醒（请先读）

1. **开隐私保护后，公开 WHOIS 显示的其实是 Dynadot 隐私代理的地址**（第 4 节第 2 步已确认开启），不是你填的地址。因此填中国拼音地址或美国地址，**对外可见性没有区别**——填美国地址的唯一作用是改变注册商内部记录，对防泄露没有额外收益。
2. **ICANN 要求注册人信息准确**（2013 注册商协议 / WHOIS 准确度项目）。填写不真实信息违反 Dynadot 服务条款，注册商有权**暂停或注销域名**；在转出、争议仲裁、找回域名等场景需要验证身份时，信息不一致会卡住流程。
3. 支付宝付款 + 中国注册人 + 隐私保护是 Dynadot 面向中国用户的正常用法，**不填美国地址也能正常完成注册**。若仍选择美国地址，视为自担风险。

## 6. 注册后必须做的三件事

1. **ICANN 邮箱验证（最重要）**：注册后 1~15 天内，注册商发来验证邮件，**点击邮件中的确认链接**。漏掉会收到暂停通知，域名解析会被停，且**未验证期间无法修改域名设置（改 NS 会被锁住）**。
   - 验证路径：后台 → 我的域名 → **联系人记录（Contact Records）** → 点该记录的 Name/Email 链接 → 解锁账户 → 滚动到 **gTLD Verification** 区域 → 点 **Send Verification Email Now（立即发送验证电子邮件）**。
   - 邮件发件人：`accounts@dynadot.com`；**10 分钟内只能重发一次**（系统提示"最后一封验证电子邮件在不足10分钟前发出"即为冷却限制，等 10 分钟再点）。
   - 邮件可能被 Gmail 丢进垃圾箱/推广标签；若已清空邮箱，用上面的重发路径重新发，无需担心（域名本身不受影响）。
   - 验证成功标志：点击邮件链接后页面显示 **"Thank you for verifying your contact information."**；后台联系人记录页 gTLD Verified 列变为 **Yes**，状态从"正在验证"变为已验证。
   - 修改联系人邮箱会立即触发新的验证邮件到新邮箱——原邮箱收不到时，可改用这个办法换一个能收信的邮箱。
2. **开启两步验证（2FA）**：Dynadot 后台 → Security / 安全设置 → 绑定 TOTP 或手机。
3. **确认自动续费**：后台 → 域名列表 → Auto-renew 开关。若用支付宝付款，确认该付款方式能否自动扣款；不能的话**设置到期提醒日历**（域名过期有 30 天宽限期，之后释放可被抢注）。

## 7. 下一步（衔接整体方案）

域名注册完成后，Cloudflare 接入（DNS → Pages 官网 → R2 下载桶）的完整照做流程见 [cloudflare-setup-checklist.md](cloudflare-setup-checklist.md)，核心步骤：

1. 注册 Cloudflare 免费账号：[cloudflare.com](https://cloudflare.com)。
2. 添加域名 `astravia.dev`，按向导把 Dynadot 里该域名的 **名称服务器（Nameservers）改为 Cloudflare 分配的两个 NS**。实际路径与坑位：
   - Dynadot 后台 **服务器（Nameservers）** 页面 → **添加域名服务器**，填入两个 Cloudflare NS；
   - 添加后列表"使用中"仍显示**否**——需点该 NS 行的 **[show]** → 蓝色框内 **"编辑域名服务器设置"** → 勾选 `astravia.dev` 应用，"使用中"变**是**才算绑定到域名；
   - 或者：管理域名 → 点 `astravia.dev` → 名称服务器设置里直接改成这两个 NS。
   - 注意 **"名称服务器"≠"DNS设置"**（DNS设置是配置解析记录的托管页，与 NS 切换无关，不要改错）。
3. 保存后注册商向注册局提交变更，**注册局权威记录生效通常需 1~60 秒到几十分钟**（公共 DNS 因缓存显示旧值属正常）。用 `dig NS astravia.dev @8.8.8.8` 或 RDAP（`curl https://rdap.org/domain/astravia.dev`）确认：显示 `elisabeth/jaime.ns.cloudflare.com` 即成功。
4. DNS 生效后，按 [website-deployment.md](website-deployment.md) 第 9 节部署官网（Cloudflare Pages）与 R2 下载桶，详细照做见 [cloudflare-setup-checklist.md](cloudflare-setup-checklist.md)。

## 8. 常见问题

| 问题 | 回答 |
|---|---|
| 支付宝单笔上限？ | RMB 30,000/笔，注册域名远低于此 |
| 需要实名/身份证吗？ | 不需要，境外注册商注册 .dev/.com 无实名要求 |
| 域名是买断吗？ | 不是，按年租赁制，断缴会被回收（见第 6 节第 3 条） |
| 为什么 .dev 必须 https？ | Google 管理后缀强制 HTTPS，官网本来就要 HTTPS，无影响 |
| 之后想换注册商？ | 注册满 60 天后可免费转出，获取转移码即可（境外注册商转出无障碍） |
| 与备案的关系？ | 无关系：境外注册 + 境外托管全程免 ICP 备案，见 [website-deployment.md](website-deployment.md) 第 2 节 |
| 验证邮件没收到/被清空？ | 后台 → 联系人记录 → gTLD Verification → 重新发送；10 分钟冷却，等时限再点（见第 6 节） |
| 改了 NS 却保存失败/不生效？ | 先确认联系人记录已验证（未验证时 Dynadot 锁住域名设置）；确认改的是"名称服务器"而不是"DNS设置"；保存后注册局生效有延迟（见第 7 节第 3 条） |
| "名称服务器"和"DNS设置"啥区别？ | 名称服务器（Nameservers）= 域名去哪台 DNS 查记录，切 Cloudflare 就改这个；DNS设置 = 配置解析记录本身，与 NS 切换无关 |
