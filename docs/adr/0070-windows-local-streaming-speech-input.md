# ADR-0070: Windows 本地流式语音输入

## 状态

Accepted

## 背景

Desktop 输入栏需要语音输入。macOS 已有成熟的系统级听写体验，本阶段只支持 Windows，且不能让
Windows 原生库、约 160 MiB 的中文模型或模型下载逻辑进入 macOS/Linux 产物。Sherpa-ONNX 的 Node
binding 是同步原生调用；若直接在 Electron 主进程中加载和解码，模型初始化或原生故障可能阻塞整个应用。

该能力同时跨越麦克风权限、Renderer 音频采集、IPC、原生模块 ABI、构建期模型校验和平台打包，不能由输入栏
组件直接拥有这些职责。

## 决策

- 首版平台合同固定为 `win32-x64`。Renderer 仅在 Windows 显示麦克风入口；其他平台不调用语音 IPC。
- 使用 `sherpa-onnx-win-x64@1.13.5` 和
  `sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30`。原生运行时进入 Windows 安装包并从 asar 解包；
  模型在 Windows 构建阶段从固定的上游 URL 下载并作为 `extraResources` 随安装包分发。
- 源码内 JSON manifest 是模型 id、采样率、文件名、长度、SHA-256 和来源的唯一事实源，构建脚本与运行时代码
  共同消费它。构建下载使用临时文件，逐文件校验成功后再原子替换；已存在且校验通过的构建缓存会复用。
- Windows 模型落在源码树中被忽略的 `resources/speech-models/<model-id>/`，安装后位于
  `Resources/speech-models/<model-id>/`。运行时不提供下载 IPC，也不访问网络；缺失或长度不符时禁用语音
  入口并提示重新安装。
- Renderer 用 16 kHz、单声道 `AudioWorklet` 以 100 ms 分块采集 PCM。preload 只暴露带类型的状态、控制、
  音频和事件合同；IPC 只接受主窗口主 frame，并限制单条音频消息大小。
- Sherpa 原生模块只在独立 Electron `utilityProcess` 中加载。主进程服务拥有模型发现、宿主生命周期和单会话
  状态机；识别宿主拥有 recognizer/stream，向主进程发 partial、final、stopped 和有限错误码。宿主启动后先发
  `ready`，主进程收到握手后才发初始化命令；宿主从 `parentPort` 的 `MessageEvent.data` 读取命令。真实 Electron
  冒烟测试覆盖 initialize、start、audio 和 stop，避免进程替身掩盖宿主协议或原生加载错误。
- Electron 的 `media` permission handler 只允许主窗口主 frame 请求纯音频，拒绝 webview、子 frame 与视频。
  Windows 系统的麦克风隐私开关仍由 Chromium/操作系统负责。
- partial 只作临时状态展示，final 通过现有编辑器 handle 插入当前光标；语音输入不创建第二套草稿状态。

## 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| Web Speech API | 否决 | 行为和联网依赖不可控，不满足稳定本地识别 |
| 主进程直接加载 Sherpa | 否决 | 同步原生初始化和解码会扩大主线程冻结影响 |
| Renderer 原生 Node 集成 | 否决 | 破坏 context isolation，并把文件路径与原生能力暴露给不可信页面边界 |
| 首次启动或首次点击时下载模型 | 否决 | 运行时依赖外网，首次交互延迟大，也让生产环境承担下载失败和半成品恢复 |
| 提交模型文件到 Git | 否决 | 大二进制会永久膨胀源码历史；使用被忽略且可校验复用的构建缓存即可 |
| 复用通用下载列表 | 否决 | 构建模型需要固定来源、逐文件哈希和原子替换，不是用户选择目的地的普通下载 |

## 后果

- Windows 安装包增加原生运行时及约 160 MiB 模型；用户安装后无需额外网络即可使用语音输入。
- macOS/Linux 构建不会声明、暂存或解包 Sherpa Windows 二进制，也不会下载模型。
- 后续增加平台或模型时，应扩展平台化运行时清单与共享 manifest，不在 UI、IPC 或打包器中追加散落分支。
- Windows 构建依赖模型源可达性；CI 可持久化 `resources/speech-models/` 以减少重复下载，但每次仍校验摘要。
- Sherpa-ONNX 运行时采用 Apache-2.0。模型会由 Vetta 安装包再分发；正式发布前必须由
  产品/法务确认该模型仓库的模型权重使用条款符合目标分发地区和商业场景。
