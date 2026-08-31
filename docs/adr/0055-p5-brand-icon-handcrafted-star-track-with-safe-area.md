# P5 品牌图标：星轨意象手工设计 + safe-area 规范，弃用 AI 生成占位

rebrand/blueprint.md 的 P5 要求 `build/icon.png` / `icon.ico` / `icon.icns` 承载 astra（星辰）+ via（路）的词源意象，蓝图第 50 行定为「星环 + 轨道」。当前 `build/icon.*` 是早期 AI 生成占位资源，应用后出现四周硬边、尺寸过大——根因是 AI 生成图标未预留 padding / safe area，且多尺寸（16/32/64/128/256/512/1024）一致性无法保证。代码层（appId / productName / 协议）已在 P2 就绪，但视觉资产若不定设计语言就产出，会反复返工，且后续品牌演进时缺乏判断「当前图标是否仍合规」的依据。需在产出前定下设计语言与产出方式，使本次产出成为可复用的品牌资产基线。

我们决定：图标设计语言固定为**星轨意象**（星环 + 轨道，呼应 astra+via 词源），不接受字母 mark 或纯几何抽象；产出方式固定为**手工设计**（设计师产出矢量源文件 + 导出全尺寸 PNG/ICO/ICNS），弃用 AI 生成；并在 `build/` 新增 `ICON-SPEC.md` 记录 safe-area 规范：最小 padding = 图标边长 × 12.5%（对应 1024 尺寸下 128px 安全区），禁止图形贴边；多尺寸需保证 16px 下仍可辨识（最小笔画 1.5px@16）。DMG 背景 `build/background.png` 与图标共用同一星轨意象色板，避免割裂。本决定与 ADR-0053（UI 设计引擎）正交：0053 决定 .vetd frame 的工程路线，本 ADR 决定应用级品牌视觉资产的产出方式，二者互不依赖。

## Considered Options

- **A 字母 mark（Astravia 首字母 A）**：被否。不承载星轨意象，与品牌故事「数据星河、轨道导航」脱节；首字母 A 类图标在工具类产品中高度同质化，易混淆。
- **B 继续用 AI 生成图标 + 事后修 padding**：被否。AI 生成无法保证多尺寸一致性（当前硬边问题即源于此）；每次重生成风格漂移，长期维护成本高于一次性手工产出；AI 输出不可作为品牌基线资产的矢量源。
- **C 手工设计星轨意象 + safe-area 规范（采纳）**：设计师精确控制 padding / safe area，多尺寸一致；规范写入 `ICON-SPEC.md` 使后续品牌演进有可复用基线；一次性成本高但摊销后最低。

## Consequences

- 需设计师产出 `icon.png` / `icon.ico` / `icon.icns` 全套 + 矢量源文件，引入一次性设计成本（不可由代码自动化替代）。
- `build/` 新增 `ICON-SPEC.md` 作为事实源；未来任何图标变更须先校验 safe-area，CI 不强制但 review 须核对。
- 品牌演进若改意象（如弃星轨改其他），`icon.*` 全套与 `ICON-SPEC.md` 需同步重做——半可逆，重做成本中等。
- DMG 背景与图标绑定同色板，任一变更须联动另一处。
- 不影响 `packages/desktop-app` 的打包脚本逻辑（prepare-pack.js 已就绪，仅替换 `build/` 资源文件）。
