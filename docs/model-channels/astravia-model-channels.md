# Astravia 模型渠道商业化方案（更新版）

**版本**: 1.2  
**日期**: 2026年8月  
**目标**: 为Astravia云端商业化提供低成本国外模型渠道，支持用户自定义大模型（BYOK）和自有渠道模型采购，用户直接为使用的模型买单。满足用户除了当前自定义模型外，还能通过我方渠道使用国外模型。

## 1. 方案概述

Astravia需要构建一套灵活的模型渠道体系：
- **支持BYOK（Bring Your Own Key）**：用户提供自己的API Key，用户直接付费给模型提供商。
- **自有渠道白标/聚合**：我方作为聚合商或代理，提供统一OpenAI兼容接口，用户通过我方渠道使用国外模型，用户付费给Astravia或直接给提供商。
- **国外模型优先**：聚焦非中国大陆模型（US/EU提供商），避免合规风险，同时支持DeepSeek、Llama、Qwen等开源模型。
- **成本优势**：目标比直接OpenAI/Claude等低30-70%。
- **集成简单**：保持OpenAI SDK兼容，便于现有代码无缝切换。

## 2. 推荐渠道列表

### 2.1 Remonker（低成本聚合，推荐）
- **URL**: https://remonker.io/
- **特点**:
  - 单API访问50+模型（GPT-5、Claude、Gemini、DeepSeek等）。
  - 批量采购节省30-87%，OpenAI兼容。
  - 支持白标API（your domain）。
  - EU网关，GDPR合规。
  - 统一计费，60M tokens起。
- **集成方式**:
  - 更换Base URL和Auth Token即可。
  - 支持Anthropic SDK等。
- **注册与使用**:
  1. 打开 https://remonker.io/ 注册账号（邮箱即可）。
  2. 登录后进入 Billing / API Keys 页面，创建 API Key（支持白标域名）。
  3. 联系商务团队提出 “White Label API” 或 “白标 API” 申请。
  4. 提供自己的域名，他们审核通过后会给你一个专用的 Base URL（如 `https://models.yourdomain.com/v1`）。
  5. 把 API Key 和 Base URL 放入 Astravia 配置：
     ```js
     const client = new OpenAI({
       apiKey: "remonker_your_key",
       baseURL: "https://models.astravia.com/v1",   // 白标后你的域名
     });
     ```
  6. 即可使用所有模型。
- **优势**: 价格低、模型丰富、易迁移。

### 2.2 Opper.ai（欧洲替代方案，推荐）
- **URL**: https://opper.ai/
- **特点**:
  - 700+模型路由（Anthropic、OpenAI、Google、Mistral、Meta、xAI等）。
  - 比OpenRouter便宜45%，OpenAI兼容。
  - EU基础设施，零数据保留（GDPR）。
  - 支持Kimi、GLM、DeepSeek等。
- **集成方式**:
  - 单API Key切换提供商，智能回退。
  - 支持EU pin。
- **注册与使用**:
  1. 访问 https://opper.ai/sign-up/free 免费注册。
  2. 登录平台.opper.ai 创建 API Key（每个项目一个）。
  3. 把 **Base URL** 设置为 `https://api.opper.ai/v3/compat`。
  4. 配置 OpenAI SDK：
     ```js
     const client = new OpenAI({
       apiKey: process.env.OPPER_API_KEY,
       baseURL: "https://api.opper.ai/v3/compat",
     });
     ```
  5. 使用模型时直接写 `model: "openai/gpt-5-mini"`。
- **优势**: 隐私强、成本低、欧洲合规。

### 2.3 Neokens（超低成本Token，推荐）
- **URL**: https://neokens.com/
- **特点**:
  - 单个Key访问多个模型（Claude、GPT、Gemini、Llama）。
  - 批量信用最高10x，OpenAI兼容。
  - 预付信用，永不过期。
  - 聚合企业承诺，成本大幅降低。
- **集成方式**:
  - 更换Base URL和API Key。
  - 统一余额跨模型使用。
- **注册与使用**:
  1. 打开 https://neokens.com/，选择信用包（$10 ~ $1000）。
  2. 支付后创建 API Key（支持白标）。
  3. 把 Key 和 **Base URL** 设置为官方提供的地址（通常 `https://api.neokens.com`）。
  4. OpenAI SDK 直接用：
     ```js
     const client = new OpenAI({
       apiKey: "neokens_your_key",
       baseURL: "https://api.neokens.com/v1",
     });
     ```
  5. 所有模型共享一个余额，使用任意模型。
- **优势**: 最便宜，适合高频使用。

## 3. 比较矩阵

| 渠道          | 成本优势 | 模型覆盖 | 兼容性 | 合规/白标 | 推荐场景          |
|---------------|----------|----------|--------|-----------|-------------------|
| Remonker      | ★★★★★   | ★★★★★   | OpenAI | 白标支持  | 统一API聚合     |
| Opper.ai      | ★★★★★   | ★★★★    | OpenAI | EU GDPR   | 隐私/合规用户   |
| Neokens       | ★★★★★★  | ★★★★    | OpenAI | 简单      | 高频Token消费   |

## 4. 实施建议

1. **集成步骤**:
   - 在Astravia后端添加模型提供商配置面板，支持BYOK和聚合密钥。
   - 保持OpenAI兼容，新增"渠道模型"选项。
   - 测试各渠道延迟、价格、可用性。

2. **用户侧**:
   - 提供API Key管理面板，用户自行添加/切换渠道。
   - 支持"使用我方渠道"开关，用户选择自购或我方代理。
   - 定价策略：Astravia收取管理费或直接转账。

3. **合规与安全**:
   - 确保数据不训练（zero data retention）。
   - 提供DPA/GDPR支持。
   - 监控API Key泄露风险。

4. **下一步**:
   - 联系Remonker、Opper.ai、Neokens等代理签署代理协议（申请白标）。
   - 开发集成SDK。
   - 内部测试成本比对。
   - 文档更新和用户培训。

## 5. 风险与注意事项

- 模型提供商政策变化。
- 汇率波动（美元计费）。
- 合规审查（尤其是美国出口管制）。
- 建议优先测试核心模型（GPT系列、Claude、DeepSeek、Llama）。

## 6. 白标（White Label）实操教程

### 6.1 白标是什么

一句话：**借第三方的“货”（模型接入、路由、计费、合规），打自己的品牌卖给自己的客户。**

以 Remonker 为例：它背后已接好 GPT、Claude、Gemini、DeepSeek 等 50+ 模型并管理路由/计费/合规；白标后你拿到一个挂在**自己域名**下的专用 Base URL 和专用 API Key。你的用户用 OpenAI SDK 连**你的域名**、用**你发的 Key**，流量由 Remonker 处理，账单记在你头上。用户全程只看到 Astravia 品牌。

三种模式对比：

| 模式 | Key 是谁的 | 用户连哪 | 用户付钱给谁 | 前台品牌 |
|---|---|---|---|---|
| BYOK（用户自带 Key） | 用户自己 | 官方渠道 | 模型厂商 | 用户自己的 |
| 普通聚合 Key | 你的 | api.remonker.io | Remonker → 你 | 你（后台是 Remonker） |
| **白标（需申请）** | 你的 | models.astravia.com（你的域名） | 你（可加价） | **完全你的** |

本质是**聚合转售（reseller）**：不用自己对接几十家厂商，利润来自差价或管理费。注意白标不等于免费——你的成本仍是 Remonker 的价格。

### 6.2 域名准备

**官网域名 ≠ 白标 API 域名**。`www.astravia.com` 跑网站，白标接口要用独立的 API 子域名（如 `models.astravia.com`），原因是：

- API 流量与网站流量分离，互不干扰；
- Remonker 需要“接管”该子域名的流量（CNAME 指向其网关）；
- 便于独立签发 SSL 证书与独立计费统计。

**关键：子域名免费。** 在 Cloudflare 拥有根域名 `astravia.com` 后，创建子域名只是添加一条 DNS 记录，**不需要单独花钱注册**，也不产生任何费用。

流程（按顺序）：

1. 申请时，按 Remonker 邮件要求添加一条 **TXT 验证记录**（形如 `remonker-verify=xxxx`），证明域名归你所有——这是审核的核心；
2. 审核通过后，添加 **CNAME 记录**：`models.astravia.com` → Remonker 提供的网关地址（具体内容以邮件为准）；
3. **SSL 证书一般由 Remonker 自动签发**（Let's Encrypt 类），无需自购；
4. DNS 记录请等商务邮件回复后再按指示添加，不要提前乱加。

前置条件：确认你的 Cloudflare 账户对 `astravia.com` 有完整 DNS 管理权限（能手动添加 TXT/CNAME 记录）。

### 6.3 商务侧准备

1. **发申请邮件**（模板见第 7 节）——这是启动流程的第一步；
2. **最低充值/承诺量**：Remonker 白标以 60M tokens 起（每月用量承诺或起充档位），具体数额问商务；
3. **支付方式确认**：EU 服务商，确认接受信用卡/电汇/crypto 等，中国公司付款需提前确认；
4. **主体信息**：代理协议可能需要公司英文名、注册地址、税号（VAT/TIN）；GDPR 合规需签 **DPA（数据处理协议）**，确认 zero data retention 落到纸面。

### 6.4 价格：60M tokens 多少钱

**60M tokens 不是“价格”，是起订量/承诺量门槛**，实际花费取决于模型组合，模型间价差可达 100 倍：

| 模型类型 | 举例 | 每百万 token 成本（输入+输出混合） | 60M/月估算 |
|---|---|---|---|
| 白菜价开源 | DeepSeek、Llama | $0.1 ~ 0.5 | $10 ~ 40 |
| 主流闭源 | Claude Sonnet、GPT-5、Gemini Pro | $1 ~ 5 | $60 ~ 300 |
| 顶级闭源 | Claude Opus、GPT-5 高配 | $5 ~ 30 | $300 ~ 1800 |

建议：从 Remonker 后台 **Models 页面**抄实时价格，按输入:输出 ≈ 3:1 的比例估算 60M 混合成本；商务也会反过来问你“流量主要跑哪些模型”。

#### 6.4.1 计划开放模型价格表（以 Remonker Models 页为准）

登录后台 **https://remonker.io/dashboard/models** 可查看全部模型的实时单价（$ / 每百万 token）。下表为 Astravia 计划开放的核心模型，**估算价按官方直连价约 5 折填写，仅作预算参考，正式测算请替换为后台实际价**：

| 模型 | 输入 $/M（估算） | 输出 $/M（估算） | 60M/月混合估算 | 后台实际价（待填） |
|---|---|---|---|---|
| GPT-5 系列 | 0.8 | 4.0 | ~$96 | 输入 ___ / 输出 ___ |
| Claude Sonnet | 1.5 | 7.5 | ~$180 | 输入 ___ / 输出 ___ |
| Gemini 2.5 Pro | 0.6 | 5.0 | ~$102 | 输入 ___ / 输出 ___ |
| DeepSeek V3 | 0.14 | 0.55 | ~$15 | 输入 ___ / 输出 ___ |
| Llama 3.3 70B | 0.20 | 0.30 | ~$14 | 输入 ___ / 输出 ___ |

混合成本公式：`60M × (0.75 × 输入价 + 0.25 × 输出价)`，假设输入:输出 = 3:1。把后台实际价填进最后一列，公式一算即可得到真实月成本，并据此倒推用户定价与毛利。

### 6.5 接入步骤（白标落地后）

1. 拿到白标 Base URL（`https://models.astravia.com/v1`）和白标 Key；
2. 配置进 Astravia 后端，作为“渠道模型”选项上线（保持 OpenAI SDK 兼容）；
3. 内部测试延迟/价格，对比 Remonker / Opper / Neokens 三家（见第 3 节矩阵），再定用户定价（管理费或加价）；
4. **正式上线前不要把普通 Key 发给客户**——普通 Key 绑定你的账号余额，客户一用就烧你的钱；对外只发白标 Key。

## 7. Remonker 白标申请邮件模板（英文）

**主题**：White Label API Partnership Inquiry — Astravia (models.astravia.com)

```
Subject: White Label API Partnership Inquiry — Astravia

Dear Remonker Business Team,

I'm reaching out on behalf of Astravia (https://www.astravia.com), an AI
platform that provides model services to our users. We are interested in
setting up a White Label API partnership with Remonker to resell models
through our own domain.

About us:
- Company / Product: Astravia — cloud AI platform serving [N] users,
  offering custom models plus aggregated third-party models to end users
- Website: https://www.astravia.com

White label details:
- Proposed API domain: models.astravia.com (we own the root domain
  astravia.com on Cloudflare and can add the required DNS records
  immediately)
- Use case: Resell aggregated models (OpenAI, Anthropic, Google, DeepSeek,
  Llama, etc.) to our end users under our own brand; users pay us and we
  pay Remonker
- Integration: OpenAI-compatible API — a single Base URL and API keys for
  our backend

Estimated usage:
- Initial volume: ~60M tokens per month
- Expected growth: up to [X]M tokens per month within [6/12] months
- Planned model mix: GPT-5 series, Claude Sonnet, Gemini, DeepSeek, Llama
  (subject to your pricing)

Questions we would like to clarify:
1. Minimum top-up / monthly commitment requirements for white label
2. Volume pricing tiers and estimated discount vs. official direct pricing
3. Payment methods accepted (card / wire transfer / crypto)? — we are
   based in [China]
4. DPA / GDPR terms — confirmation of zero data retention
5. Next steps: what do you need from us to start the review (company
   documents, DNS verification records)?

We are ready to provide any required documents and look forward to your
reply.

Best regards,
[Your Name]
[Your Title]
Astravia
[your-email@astravia.com]
```

发送前替换占位符：`[N]`（用户数）、`[X]`（预期月用量）、`[6/12]`（增长周期）、`[China]`（公司所在地）、`[Your Name]` / `[Your Title]` / `[your-email@astravia.com]`。

**联系方式**: 建议与各提供商商务团队沟通代理合作。Astravia内部可对接销售/商务团队获取最新报价。

此方案已放置于 `docs/model-channels/astravia-model-channels.md`。