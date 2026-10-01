---
status: accepted
---

# astravia-file:// 静态文件协议以 pathname 承载绝对路径

「移动UI预览」插件（活动面板插件 tab）要在 iframe 里整页预览项目内的 HTML。既有手段都不成：内置 HTML 预览的 iframe `srcDoc` 没有文档基准 URL，HTML 内相对引用的 css/js/图片全部断链；`astravia-media://` 只配音频 mime，且路径走 query 参数（`?path=<encoded>`）——浏览器解析相对资源时只继承 pathname、丢弃 query，相对引用必然解析错。

决定：主进程新增通用静态文件协议 `astravia-file://local/<绝对路径>`，**pathname 直接承载文件绝对路径**。由此 HTML 内的相对资源按所在目录天然解析正确（`./style.css` → 同目录的 astravia-file URL），无需改写 HTML。mime 按扩展名映射常见 web 资源（html/css/js/json/图片/字体等），未知回退 `application/octet-stream`；路径校验复用 `assertPathReadableForPreview`（项目根或用户主目录内可读），与 `fs.readFile` / `astravia-media://` 同一道沙箱边界。

与 `astravia-media://` 刻意并存不合并：media 专责音视频 Range 流（query 参数形态正是为了规避 Chromium 对 pathname 的编码改写，对单文件流无害），astravia-file 专责静态整文件、依赖 pathname 形态换取相对资源解析。两者职责与 URL 形态都不同，强行统一会让任一侧背上对方的约束。

被拒方案：继续用 `srcDoc` + 只支持单文件内联 HTML——移动 UI 预览场景的 agent 产物常带外链资源，断链会被误判为插件 bug。

后果：URL 形态（`local` host + pathname 路径）一旦被插件/内置预览依赖即成契约；后续内置 HTML 预览如需相对资源支持，应复用本协议而非再造。
