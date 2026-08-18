# 音频预览经自定义流式 protocol 加载，不复用 readFile base64

`FilePreviewView` 既有所有预览类型（图片/pdf/docx/文本）都经 `window.vetta.fs.readFile` IPC 以 utf8/base64 字符串全量送进渲染进程。音频不同：wav/flac 无损文件可达百 MB，沿用该路径会全量驻留内存、IPC 传输期间明显阻塞，且 seek 要等整文件就绪。决定在 desktop 主进程用 `protocol.handle()` 注册 `vetta-media://`（[[媒体流协议]]），把校验过的本地路径映射为支持 Range 请求的流式响应，`<audio src>` 直接指向它。既有小文件预览类型**不迁移**，两条路径长期并存。

## Considered Options

- **复用 readFile + Blob URL**：实现最简、与现状一致，但大文件全量进内存、需另加大小上限兜底。被否。
- **file:// 直接引用**：需放宽 webSecurity，安全不可取。被否。

## Consequences

- 主进程必须做路径校验，防止渲染进程借该协议任意读取磁盘文件。
- 协议响应需正确处理同源/CORS 头，否则 Web Audio `AnalyserNode`（黑胶播放器的频谱可视化）对跨源媒体只能读到零数据。
- 远程 URL 音频直接以原 URL 作 `src`，不经本协议；跨源时频谱可视化降级关闭。
- 未来视频预览复用本协议，不再新开加载通道。
