# web-element-picker 扩展商店上架清单（照做式）

> 前置：三期扩展已实现并验证（MV3 v0.3.1，E2E 8/8），见 [selector-plugin-integration.md §12](selector-plugin-integration.md)。
> 商业化定案：扩展**整体买断收费**（全部能力需授权码）；**Edge Add-ons 优先 → Chrome Web Store**；爱发电渠道售卖。
> 本文是照做式清单：注册账号 → 备齐物料 → 隐私政策 → 收款发码 → 正式密钥 → 提交审核。

---

## 1. 前置条件

| 项 | 说明 | 状态 |
|---|---|---|
| 商店发布包 | `packages/plugins/externals/web-element-picker/extension/release/web-element-picker-extension-0.3.1.zip` | ✅ 已有 |
| R2 公开直链 | `https://dl.astravia.dev/plugins/web-element-picker-extension-0.3.1.zip`（桶 `astravia-downloads` → `plugins/`，自定义域名 `dl.astravia.dev`） | ✅ 已上传并实测 200（2026-08-30） |
| 扩展图标 | `extension/assets/icon16/32/48/128.png` | ✅ 已有 |
| 正式签名私钥 | `.secrets/license-private.jwk.json`（当前为测试密钥，上架前须切换，见第 6 节） | ⚠️ 需切换 |
| 隐私政策 URL | 商店必填，见第 4 节 | ❌ 需准备 |
| 爱发电主页 URL | 替换 `_locales` 中 `licenseBuyUrl`，见第 5 节 | ❌ 需提供 |
| 开发者账号 | Edge（微软 Partner Center）+ Chrome（Google），见第 2 节 | ❌ 需注册 |

## 2. 注册开发者账号

### 2.1 Edge Add-ons（优先）
1. 打开 [Microsoft Partner Center](https://partner.microsoft.com/) → 注册开发者账号（微软账号即可，一次性注册费约 $12）。
2. 注册后进入 **Partner Center → Edge 扩展** 工作区。

### 2.2 Chrome Web Store
1. 打开 [Chrome Web Store 开发者控制台](https://chromewebstore.google.com/)（用 Google 账号，一次性注册费 $5）。
2. 注册时需填开发者姓名、邮箱；可选官网（建议填 `https://astravia.dev` 或留空，**隐私政策 URL 必填**）。

## 3. 商店物料（文案已备好，直接复制）

### 3.1 名称
- 中文：**Astravia 网页元素选择器**
- English：**Astravia Web Element Picker**

### 3.2 短描述（约 130 字符内）
- 中文：在任意网页点选元素，生成 CSS 选择器、XPath、React 组件链等结构化上下文，一键复制或发送给 AI。
- English：Pick elements on any webpage, generate structured context (CSS selectors, XPath, React component chains), then copy or send it to your AI assistant.

### 3.3 长描述（商店详情页）
> 中文版：
>
> Astravia 网页元素选择器让 AI 编程助手"看懂"你的网页：
>
> - 在任意网页进入选择模式，悬停预览、单击选中、Shift+单击多选、拖拽框选
> - 生成结构化上下文：CSS 选择器、XPath、语义路径、React 组件链、文本内容
> - 一键复制提示词 / Markdown，或发送给 Astravia 对话（剪贴板交接）
> - 写轮眼模式输出高保真复刻报告（DOM + 生效样式 + 状态）
> - 元素截图保存到本地
>
> 使用：点击扩展图标 → 输入授权码激活（买断制）→ 打开任意网页 → 开始选择。
>
> 隐私：全部能力在本地处理，不收集、不上传任何数据。
>
> English version:
>
> Astravia Web Element Picker lets your AI coding assistant "see" your webpage:
>
> - Pick elements on any page: hover to preview, click to select, Shift+click for multi-select, drag to box-select
> - Generate structured context: CSS selectors, XPath, semantic paths, React component chains, and text
> - Copy the prompt / Markdown with one keystroke, or hand it to an Astravia conversation via clipboard
> - "Sharingan" mode outputs a high-fidelity reproduction report (DOM + computed styles + state)
> - Save element screenshots locally
>
> Usage: click the extension icon → activate with a license code (one-time purchase) → open any webpage → start selecting.
>
> Privacy: everything runs locally. No data is collected or uploaded.

### 3.4 类别与语言
- 类别：开发者工具（Developer Tools）
- 语言：中文（简体）+ English

### 3.5 截图（商店必填，至少 1 张，建议 3 张）

截图脚本已就位，可直接产出：

```bash
cd packages/plugins/externals/web-element-picker && bun extension/scripts/store-screenshots.mjs
```

前置：已执行 `bun extension/scripts/build-extension.mjs`（需加载 `extension/dist`）且 `.secrets/license-private.jwk.json` 存在（脚本会动态签发测试授权码 SHOT-0001）。输出到 `extension/release/screenshots/`：

| 文件 | 内容 | 尺寸 |
|---|---|---|
| `01-activate.png` | popup 激活表单（授权码输入界面，中文界面） | 320x460 |
| `02-selecting.png` | 演示页上悬停高亮 + 右下角状态胶囊（「选择中 PRO 0」） | 1280x800 |
| `03-result.png` | 3 个元素选中 + 展开命令面板（元素列表 / 快捷键 / 操作按钮） | 1280x800 |

三张图均为简体中文界面（脚本以 `--lang=zh-CN` 启动 Chromium），与目标用户一致。若商店要求的尺寸不同（Chrome 亦接受 640x400），可直接上传 1280x800 版本，或按需缩放后重新命名上传。

### 3.6 权限说明（提交时逐条填写用途）
| 权限 | 用途说明 |
|---|---|
| `activeTab` | 仅在用户点击扩展图标后访问当前网页，用于注入元素选择器；不后台访问其他页面 |
| `storage` | 本地保存授权码与用户设置 |
| `clipboardWrite` | 将选中的上下文 / 提示词复制到剪贴板 |
| `downloads` | 将元素截图保存到本地下载目录 |

## 4. 隐私政策（商店必填 URL）

把下面模板托管为一个可访问的网页（GitHub Pages、自有站点或 astravia.dev 均可），URL 填进商店后台。

> **隐私政策（Privacy Policy）**
>
> Astravia 网页元素选择器（"本扩展"）：
>
> 1. **不收集数据**：本扩展不收集、不传输、不共享任何个人数据或浏览数据。
> 2. **全部本地处理**：所有功能（元素选择、上下文生成、授权码校验、截图保存）均在本地完成。
> 3. **无远程代码**：扩展不加载任何远程脚本或内容。
> 4. **授权码**：授权码仅用于本地校验购买状态（ECDSA 验签），校验结果保存在浏览器本地存储。
> 5. **第三方服务**：扩展不集成任何第三方分析或广告服务。
>
> 联系方式：<你的邮箱>

## 5. 收款与发码（爱发电）

1. 注册/登录 [爱发电](https://afdian.com)，创建商品：**Astravia 网页元素选择器 - 授权码买断**，定价建议 12.6 元（最终由你定），商品说明写清楚"付款后联系获取授权码"。
2. 把真实爱发电主页/商品 URL 替换到两处 `licenseBuyUrl`：
   - `extension/_locales/zh_CN/messages.json`
   - `extension/_locales/en/messages.json`
   - 改完重跑 `bun extension/scripts/build-extension.mjs` 并重新加载扩展。
3. **发码流程**（每次售出一单执行一次）：
   ```bash
   cd packages/plugins/externals/web-element-picker
   bun extension/scripts/license-sign.mjs --order <订单号> --expire <YYYYMMDD>
   # 例：bun extension/scripts/license-sign.mjs --order ASTR-2026-0001 --expire 20291231
   ```
   输出的 `WEP-...` 码发给买家。有效期含当日 23:59:59。

## 6. 正式密钥切换（上架前必须，勿用测试密钥）

1. **离线备份**：把当前 `.secrets/` 私钥加密备份到至少两处（U 盘 / 密码管理器），标注用途。
2. **生成正式密钥对**：运行 `bun extension/scripts/license-keygen.mjs`（覆盖 `.secrets/` 并更新 `extension/src/license-public.jwk.json`）。注意：**切换后旧授权码（含测试码）全部失效**。
3. **重建 + 验证**：
   ```bash
   bun extension/scripts/build-extension.mjs   # 重建 dist + zip（内含新公钥）
   bun extension/scripts/e2e.mjs               # 8/8 应通过（密钥切换后测试码须用新私钥重新签发）
   bunx tsc --noEmit -p extension/tsconfig.json
   ```
4. **私钥保管**：正式私钥只用于发码，不随代码提交、不放入商店包（商店包仅含公钥）。
5. **轮换策略**：若怀疑私钥泄露 → 重新生成密钥对 + 重建发布 + 通知存量买家换码。

## 7. 提交与审核

### 7.1 Edge Add-ons（优先）
1. Partner Center → 创建新扩展 → 上传 `web-element-picker-extension-0.3.1.zip`。
2. 填写名称 / 描述 / 图标 / 截图 / 类别 / 隐私政策 URL / 支持邮箱。
3. 填写权限说明（§3.6 表格）。
4. 提交审核（通常数天）。

### 7.2 Chrome Web Store
1. 开发者控制台 → 新建条目 → 上传 `web-element-picker-extension-0.3.1.zip`。
2. 填写商店信息（§3 全部物料）+ 隐私权部分（隐私政策 URL、权限说明、数据使用声明：不收集）。
3. 提交审核（通常数天到两周）。

### 7.3 付费墙风险与退路（§12.3 定案）
- **风险**：Chrome 政策要求应用内数字商品走商店支付，扩展无内购能力 → 付费墙扩展**可能被拒**；Edge 相对宽松，故 Edge 优先。
- **接受**：商店版即完整版（含授权码激活 UI），如实提交。
- **被拒退路**：商店版降级为免费基础层（点选/复制）+ 进阶能力（发送给 AI / 写轮眼 / 截图）走自托管分发（见 [selector-plugin-integration.md §12.3](selector-plugin-integration.md)）。

## 8. 检查清单

- [ ] Edge 开发者账号注册完成
- [ ] Chrome 开发者账号注册完成
- [ ] 商店名称 / 短描述 / 长描述（中英）已填
- [ ] 图标（16/32/48/128）已传
- [ ] 截图 3 张已传
- [ ] 隐私政策已托管为 URL 并填写
- [ ] 权限说明已填写（§3.6）
- [ ] 爱发电商品已创建，`licenseBuyUrl` 已替换并重建
- [ ] 正式密钥对已生成、私钥已离线备份
- [ ] 重建 + E2E 8/8 + 扩展 tsc 通过
- [ ] 测试授权码已用新私钥重新签发
- [ ] Edge Add-ons 提交
- [ ] Chrome Web Store 提交
