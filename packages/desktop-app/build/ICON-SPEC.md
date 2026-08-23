# ICON-SPEC：Astravia 品牌图标规范

事实源：`scripts/astravia-brand-icon.svg`（1024×1024 矢量源，唯一权威定义）。

任何图标变更必须先从该 SVG 出发，并按本规范校验后再产出 `build/icon.*` 与 DMG 背景。

## 设计语言

- 星轨意象：星环（倾斜椭圆轨道）+ 抵达的星辰（金色行星）+ 少量点缀星，呼应 astra（星辰）+ via（路）词源。
- 底色为 indigo 渐变深空；行星金色；轨道/点缀星浅灰白。

## Safe Area

- 画布 1024×1024，`viewBox="0 0 1024 1024"`。
- 所有图形限定在 `x=128 y=128 w=768 h=768` 内，即 **padding = 12.5% = 128px**。
- 禁止图形贴边；背景圆角矩形即为此安全区的边界。

## 最小笔画（多尺寸可辨识）

- 1024 源中任何笔画/图形厚度 `≥ 96`（= 1.5px × 64），保证 16px 下 `≥ 1.5px`。
- 外轨道 `stroke-width="100"`；行星 `r="112"`；点缀星 `r="44"~"54"`。
- 意象必须"粗壮简洁"，禁止细线轨道或小噪点。

## 色板（与 generate-dmg-background.js 的 COLORS/logoDefs 一致）

| 用途 | 颜色 | 十六进制 |
| --- | --- | --- |
| 星轨主色（渐变起） | indigo | `#4f46e5` |
| 星轨主色（渐变中） | violet | `#8b5cf6` |
| 深空底（渐变终） | 深空蓝黑 | `#0b0d18` |
| 星辰/行星（渐变起） | 金 | `#fbbf24` |
| 星辰/行星（渐变终） | 琥珀 | `#f59e0b` |
| 点缀星/轨道描边 | 浅灰白 | `#dce0ea` |

## 多尺寸清单

`icon.icns` 含 16/32/64/128/256/512/1024（iconset 规则），另产出：

- `build/icon.png` — 512×512（应用图标主资源）
- `build/icon-dock.png` — 256×256（Dock 用）
- `build/icon.ico` — 256/48/32/16（Windows）
- `build/background.png` / `background@2x.png` — 660×440 / 1320×880（DMG 背景，共用本色板与星轨徽标）

## 变更流程

1. 改 `scripts/astravia-brand-icon.svg`。
2. 校验 safe area（12.5%）与最小笔画（≥96 @ 1024）后再生成。
3. `node scripts/generate-app-icon.js` → 覆盖 `build/icon.*`。
4. 如图形语言变化，同步 `scripts/generate-dmg-background.js` 的 logoDefs/logo → 重跑生成 `build/background*.png`。
5. 肉眼/工具检查 16/32/128/512 四档：四角透明、无硬边、行星与轨道可辨识。
