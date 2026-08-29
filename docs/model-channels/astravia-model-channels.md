# Astravia 模型渠道商业化方案

**版本**: 1.0  
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

### 2.1 Huipu Power (推荐首选)
- **URL**: https://www.huipupower.com/
- **特点**:
  - 提供企业级LLM API端点和批量Token推理服务。
  - 支持白标API服务模型、本地化分发、区域代理合作。
  - 透明按实际输入输出Token计费。
  - 支持Llama、DeepSeek、Qwen等开源模型。
  - 支持国际市场代理合作。
- **集成方式**:
  - 通过OpenAI兼容API使用。
  - 联系代理获取白标密钥或BYOK。
- **优势**: 成本低、支持批量、适合云端商业化分发。
- **联系**: 代理合作页面联系。

### 2.2 Remonker (低成本聚合)
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
- **优势**: 价格低、模型丰富、易迁移。
- **联系**: 注册获取白标选项。

### 2.3 Opper.ai (欧洲替代方案)
- **URL**: https://opper.ai/
- **特点**:
  - 700+模型路由（Anthropic、OpenAI、Google、Mistral、Meta、xAI等）。
  - 比OpenRouter便宜45%，OpenAI兼容。
  - EU基础设施，零数据保留（GDPR）。
  - 支持Kimi、GLM、DeepSeek等。
- **集成方式**:
  - 单API Key切换提供商，智能回退。
  - 支持EU pin。
- **优势**: 隐私强、成本低、欧洲合规。
- **联系**: 注册获取。

### 2.4 Neokens (超低成本Token)
- **URL**: https://neokens.com/
- **特点**:
  - 单个Key访问多个模型（Claude、GPT、Gemini、Llama）。
  - 批量信用最高10x，OpenAI兼容。
  - 预付信用，永不过期。
  - 聚合企业承诺，成本大幅降低。
- **集成方式**:
  - 更换Base URL和API Key。
  - 统一余额跨模型使用。
- **优势**: 最便宜，适合高频使用。
- **联系**: 直接购买信用包。

## 3. 比较矩阵

| 渠道          | 成本优势 | 模型覆盖 | 兼容性 | 合规/白标 | 推荐场景          |
|---------------|----------|----------|--------|-----------|-------------------|
| Huipu Power  | ★★★★★   | ★★★★    | OpenAI | 白标代理 | 批量云分发       |
| Remonker     | ★★★★★   | ★★★★★   | OpenAI | 白标支持  | 统一API聚合     |
| Opper.ai     | ★★★★★   | ★★★★    | OpenAI | EU GDPR   | 隐私/合规用户   |
| Neokens      | ★★★★★★  | ★★★★    | OpenAI | 简单      | 高频Token消费   |

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
   - 联系Huipu Power、Remonker等代理签署代理协议。
   - 开发集成SDK。
   - 内部测试成本比对。
   - 文档更新和用户培训。

## 5. 风险与注意事项

- 模型提供商政策变化。
- 汇率波动（美元计费）。
- 合规审查（尤其是美国出口管制）。
- 建议优先测试核心模型（GPT系列、Claude、DeepSeek、Llama）。

**联系方式**: 建议与各提供商商务团队沟通代理合作。Astravia内部可对接销售/商务团队获取最新报价。

此方案已放置于 `docs/model-channels/astravia-model-channels.md`。

## 附录
- 各渠道OpenAI兼容配置示例。
- 成本估算模板。
- 代理合作模板。