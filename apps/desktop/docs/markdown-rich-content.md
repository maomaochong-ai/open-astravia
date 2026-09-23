# Markdown 公式与页面预览

聊天回复和 Markdown 文件预览默认支持以下内容。

| 内容 | 写法 | 行为 |
| --- | --- | --- |
| 行内公式 | `$E=mc^2$` | 按公式排版，支持屏幕阅读器使用的 MathML |
| 独立公式 | 单独一行 `$$` 开始和结束 | 居中显示，较宽公式可横向滚动 |
| 公式代码块 | `math`、`latex` 或 `tex` 围栏 | 独立公式 |
| SVG | `svg` 围栏或完整 `<svg>...</svg>` | 直接显示图形；围栏提供源码切换与复制 |
| HTML | `html` 围栏、独立 HTML 块或完整 `<html>...</html>` | 静态预览，点击「运行 JavaScript」启用交互 |

推荐使用围栏传递 HTML 页面和 SVG，这样可以完整保留源码，包括空行和 Markdown 标记。公式不在普通代码、行内代码中识别；不是所有 LaTeX 宏都受 KaTeX 支持，不合法或过大的公式显示源码。

HTML 可以使用内联样式、脚本、Canvas 和 DOM 事件；可以嵌入 data 图片与字体。它不能访问 Vetta 的文件、账号、会话或宿主 API，也不能加载 CDN、外部图片、网络 API、其他网页或提交表单。需要外部依赖的页面应通过原有浏览器/项目预览功能打开。

预览过程中可以随时切换「源码」或复制原文。HTML 的「停止」会销毁运行页面并恢复静态预览；重新运行从头开始，页面输入与脚本状态不会保留。生成中先显示源码，生成完成后再预览。切换源码、滚出可见区域、窗口进入后台、内容被改写或连续运行达到 30 秒时，脚本会停止；返回后需再次点击运行。

公式使用按需启动的 Worker，持续变化时最多每 250ms 提交一次计算；相同公式复用结果。原始 SVG 的流式图像更新最多每 500ms 一次。不可见内容不进行重计算，HTML 不会随每个新 token 重新执行脚本。SVG/HTML 超过 256000 字符时保留源码、暂不预览。

浏览器沙箱隔离页面权限，但不是独立的 CPU 配额：同步死循环仍可能阻塞渲染进程，停止计时器无法打断此类脚本。因此交互页面不会在打开历史或收到回复时自动运行。

开发验证：

```powershell
bun scripts/quality/run-vitest.mjs --config apps/desktop/vitest.config.ts --run apps/desktop/src/renderer/domains/conversation/components/blocks/MarkdownRichContent.test.tsx apps/desktop/src/renderer/domains/conversation/components/blocks/markdown-math-client.test.ts
node --test apps/desktop/scripts/markdown-preview.node-test.mjs
```

第二条命令使用 Playwright 的独立无头 Chromium 与临时构建，不连接真实 Vetta 实例。需已安装该版本的 Playwright Chromium；可用 `VETTA_TEST_BROWSER` 选择已安装的浏览器通道。

扩展合同见 [消息列表与内容扩展](message-feed-extensions.md)，实现取舍见 [ADR-0128](../../../docs/adr/0128-markdown-rich-content-rendering.md)。
