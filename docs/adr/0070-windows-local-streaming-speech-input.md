# ADR-0070: Windows 本地流式语音输入

## 状态

Accepted

## 背景

Desktop 输入栏需要语音输入。macOS 已有成熟的系统级听写体验，本阶段只支持 Windows，且不能让
Windows 原生库、约 160 MiB 的中文模型或模型下载逻辑进入 macOS/Linux 产物。Sherpa-ONNX 的 Node
binding 是同步原生调用；若直接在 Electron 主进程中加载和解码，模型初始化或原生故障可能阻塞整个应用。

该能力同时跨越麦克风权限、Renderer 音频采集、IPC、原生模块 ABI、可恢复下载和平台打包，不能由输入栏
组件直接拥有这些职责。

## 决策

- 首版平台合同固定为 `win32-x64`。Renderer 仅在 Windows 显示麦克风入口；其他平台不调用语音 IPC。
- 使用 `sherpa-onnx-win-x64@1.13.5` 和
  `sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30`。原生运行时进入 Windows 安装包并从 asar 解包；
  模型不随安装包分发，首次使用时从上游 Hugging Face 仓库按固定 URL 下载。
- 模型清单是文件名、长度和 SHA-256 的唯一事实源。下载写入 `speech-recognition` 应用缓存命名空间的临时
  目录；全部文件校验成功后才切换为可用目录。取消、网络错误或校验失败不会留下可被识别为已安装的半成品。
- Renderer 用 16 kHz、单声道 `AudioWorklet` 以 100 ms 分块采集 PCM。preload 只暴露带类型的状态、控制、
  音频和事件合同；IPC 只接受主窗口主 frame，并限制单条音频消息大小。
- Sherpa 原生模块只在独立 Electron `utilityProcess` 中加载。主进程服务拥有下载、宿主生命周期和单会话
  状态机；识别宿主拥有 recognizer/stream，向主进程发 partial、final、stopped 和有限错误码。
- Electron 的 `media` permission handler 只允许主窗口主 frame 请求纯音频，拒绝 webview、子 frame 与视频。
  Windows 系统的麦克风隐私开关仍由 Chromium/操作系统负责。
- partial 只作临时状态展示，final 通过现有编辑器 handle 插入当前光标；语音输入不创建第二套草稿状态。

## 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| Web Speech API | 否决 | 行为和联网依赖不可控，不满足稳定本地识别 |
| 主进程直接加载 Sherpa | 否决 | 同步原生初始化和解码会扩大主线程冻结影响 |
| Renderer 原生 Node 集成 | 否决 | 破坏 context isolation，并把文件路径与原生能力暴露给不可信页面边界 |
| 模型随安装包分发 | 否决 | 所有 Windows 用户承担约 160 MiB 增量，也无法独立修复或替换模型 |
| 复用通用下载列表 | 否决 | 模型需要固定来源、逐文件哈希、原子安装和领域状态，不是用户选择目的地的普通下载 |

## 后果

- Windows 安装包只增加原生运行时体积；模型缓存位于 `~/.vetta/cache/speech-recognition/`，可删除后重下。
- macOS/Linux 构建不会声明、暂存或解包 Sherpa Windows 二进制，也不会下载模型。
- 后续增加平台或模型时，应扩展平台化运行时清单和模型 catalog，不在 UI、IPC 或下载器中追加散落分支。
- 首次使用依赖 Hugging Face 可达性；失败可由同一按钮重试，尚未实现断点续传和模型设置页管理。
- Sherpa-ONNX 运行时采用 Apache-2.0。模型从上游直接下载、不由 Vetta 安装包再分发；正式发布前仍需由
  产品/法务确认该模型仓库的模型权重使用条款符合目标分发地区和商业场景。
