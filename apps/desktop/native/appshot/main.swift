// appshot-helper：捕获前台应用窗口——AX 结构化文本 + 源文件路径 + 窗口截图 PNG，
// stdout 输出单个 JSON（UTF-8）后退出。由 desktop-app 主进程 spawn（见
// src/main/appshot/），CLI 契约见仓库 appshot 规格。打包为
// `Vetta Computer Use.app`（scripts/build-appshot-helper.js），独立 bundle id
// 使其在 TCC（辅助功能/屏幕录制）里是与主 app 分离的授权主体。
//
// 三种模式，均先过 self-disclaim（见下）：
//
// 1. 捕获（默认）：--out-dir <绝对目录> [--no-screenshot] [--exclude-pid <pid>]
//    成功：{"ok":true,"appName":"...","bundleId":"...","windowTitle":"...",
//           "documentPath":"/abs"|null,"axText":"..."|null,
//           "pngPath":"/abs/capture.png"|null,"iconPath":"/abs/icon.png"|null}
//    失败：{"ok":false,"error":"<code>","message":"..."}，exit code 非 0。
// 2. 查权限：--check-permissions
//    → {"accessibility":bool,"screenRecording":bool}，exit 0（无 ok 字段，单独 shape）
// 3. 请求权限（引导用，弹系统授权）：--request-permissions
//    → CGRequestScreenCaptureAccess() + AXIsProcessTrustedWithOptions(prompt:true)，
//      输出同 --check-permissions 的 JSON 后 exit 0
//
// self-disclaim：main 最前面，若 VETTA_CU_DISCLAIMED != "1"，用
// POSIX_SPAWN_SETEXEC + dlsym 拿到的私有符号 responsibility_spawnattrs_setdisclaim
// re-exec 自己（argv 原样、setenv VETTA_CU_DISCLAIMED=1），使 helper 脱离父进程
// 责任链、成为独立 TCC 主体。拿不到符号/调用失败则清标记继续正常执行（降级）。
//
// 单文件 swiftc 编译（scripts/build-appshot-helper.js）。截图优先
// SCScreenshotManager（macOS 14+，async API 用信号量桥接回同步 main），
// 旧系统回退 CGWindowListCreateImage。AX 无权限时 axText/documentPath 为
// null，不算失败；无屏幕录制权限时 pngPath/iconPath 为 null，同样不算失败。

import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import ScreenCaptureKit

// MARK: - self-disclaim（脱离父进程 TCC 责任链，必须最先执行）

reexecDisclaimedIfNeeded()

/// Re-exec 自身并通过私有 API 声明「responsibility disclaim」，使 helper 在 TCC
/// 眼中是独立主体，而非继承发起进程（Electron 主进程）的权限归属。私有符号
/// 运行时用 dlsym 探测，取不到或调用失败则清掉标记、静默降级继续正常执行——
/// 仅权限归属仍挂在父进程下，功能不受影响。
func reexecDisclaimedIfNeeded() {
	if ProcessInfo.processInfo.environment["VETTA_CU_DISCLAIMED"] == "1" { return }
	guard let handle = dlopen(nil, RTLD_LAZY) else { return }
	guard let sym = dlsym(handle, "responsibility_spawnattrs_setdisclaim") else { return }
	typealias SetDisclaimFn = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
	let setDisclaim = unsafeBitCast(sym, to: SetDisclaimFn.self)

	var attr: posix_spawnattr_t?
	guard posix_spawnattr_init(&attr) == 0 else { return }
	defer { posix_spawnattr_destroy(&attr) }
	guard setDisclaim(&attr, 1) == 0 else { return }
	guard posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETEXEC)) == 0 else { return }

	setenv("VETTA_CU_DISCLAIMED", "1", 1)

	let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
	var pid: pid_t = 0
	let executablePath = CommandLine.arguments[0]
	_ = posix_spawn(&pid, executablePath, nil, &attr, argv, environ)
	// SETEXEC 成功会替换当前进程映像、不会返回到这里；能执行到此说明失败，
	// 清掉标记继续正常执行（降级路径），并释放 argv 复本。
	unsetenv("VETTA_CU_DISCLAIMED")
	for pointer in argv where pointer != nil { free(pointer) }
}

// MARK: - JSON 输出

func emit(_ object: [String: Any], exitCode: Int32) -> Never {
	let data =
		(try? JSONSerialization.data(withJSONObject: object))
		?? Data("{\"ok\":false,\"error\":\"json-encode\",\"message\":\"failed to encode result\"}".utf8)
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write(Data("\n".utf8))
	exit(exitCode)
}

func fail(_ code: String, _ message: String) -> Never {
	emit(["ok": false, "error": code, "message": message], exitCode: 1)
}

func orNull(_ value: String?) -> Any {
	if let value { return value }
	return NSNull()
}

// MARK: - AX 工具

func axCopy(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
	guard error == .success else { return nil }
	return value
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
	axCopy(element, attribute) as? String
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
	guard let raw = axCopy(element, attribute) else { return nil }
	guard CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
	return (raw as! AXUIElement)
}

/// 目标窗口回退链：焦点窗口 → 主窗口 → 窗口列表首个。
/// 有些应用把 AX 焦点放在具体控件上，kAXFocusedWindowAttribute 会返回 nil，需回退。
func resolveTargetWindow(_ axApp: AXUIElement) -> AXUIElement? {
	if let window = axElement(axApp, kAXFocusedWindowAttribute) { return window }
	if let window = axElement(axApp, kAXMainWindowAttribute) { return window }
	if let windows = axCopy(axApp, kAXWindowsAttribute) as? [AXUIElement] { return windows.first }
	return nil
}

/// 将 AXDocument 值归一为本地文件路径。AXDocument 通常是 file:// URL，
/// 但路径含中文/空格且未正确 percent-encode 时 URL(string:) 会失败，需手动兜底。
func normalizeDocumentPath(_ raw: String) -> String {
	guard raw.hasPrefix("file://") else { return raw }
	if let url = URL(string: raw) { return url.path }
	let stripped = String(raw.dropFirst("file://".count))
	return stripped.removingPercentEncoding ?? stripped
}

/// 从窗口取源文件路径（AXDocument）。空/无则 nil。
func documentPathOf(_ window: AXUIElement) -> String? {
	guard let document = axString(window, kAXDocumentAttribute), !document.isEmpty else { return nil }
	return normalizeDocumentPath(document)
}

/// 深度优先遍历收集 AXTitle/AXDescription/AXHelp/AXValue 文本。
/// 跳过安全输入框（密码框）的值；上限 20000 节点 / 2MB 字符 / 8s 墙钟，防超大或慢速窗口卡死。
func collectAXText(from root: AXUIElement) -> String? {
	let maxNodes = 20000
	let maxChars = 2 * 1024 * 1024
	let deadline = Date().addingTimeInterval(8)
	var pieces: [String] = []
	var totalChars = 0
	var visitedNodes = 0
	var stack: [AXUIElement] = [root]

	outer: while let element = stack.popLast() {
		visitedNodes += 1
		if visitedNodes > maxNodes { break }
		if Date() > deadline { break }

		// 安全输入框：role 恒为 AXTextField、以 subrole=AXSecureTextField 区分，须查 subrole 才能跳过其值。
		let role = axString(element, kAXRoleAttribute)
		let subrole = axString(element, kAXSubroleAttribute)
		let isSecure = role == "AXSecureTextField" || subrole == "AXSecureTextField"
		var attributes = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute]
		if !isSecure {
			attributes.append(kAXValueAttribute)
		}
		for attribute in attributes {
			guard let text = axString(element, attribute) else { continue }
			let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
			if trimmed.isEmpty { continue }
			pieces.append(trimmed)
			totalChars += trimmed.count + 1
			if totalChars >= maxChars { break outer }
		}

		if let children = axCopy(element, kAXChildrenAttribute) as? [AXUIElement] {
			// 逆序压栈，保持文档顺序输出
			for child in children.reversed() {
				stack.append(child)
			}
		}
	}

	let joined = pieces.joined(separator: "\n")
	return joined.isEmpty ? nil : joined
}

// MARK: - 截图

/// 取该 pid 最前面的普通层级（layer 0）窗口 ID。
func frontWindowID(for pid: pid_t) -> CGWindowID? {
	let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
	guard let infos = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
		return nil
	}
	for info in infos {
		guard let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t, ownerPid == pid else { continue }
		guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
		guard let number = info[kCGWindowNumber as String] as? Int else { continue }
		return CGWindowID(number)
	}
	return nil
}

@available(macOS 14.0, *)
func captureWithScreenCaptureKit(windowID: CGWindowID) -> CGImage? {
	// SCScreenshotManager 只有 async API；helper 是同步 main，用信号量桥接。
	final class ResultBox: @unchecked Sendable {
		var image: CGImage?
	}
	let box = ResultBox()
	let semaphore = DispatchSemaphore(value: 0)
	Task.detached {
		defer { semaphore.signal() }
		do {
			let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
			guard let window = content.windows.first(where: { $0.windowID == windowID }) else { return }
			let filter = SCContentFilter(desktopIndependentWindow: window)
			let configuration = SCStreamConfiguration()
			let scale = CGFloat(filter.pointPixelScale)
			configuration.width = max(1, Int(window.frame.width * scale))
			configuration.height = max(1, Int(window.frame.height * scale))
			configuration.showsCursor = false
			configuration.captureResolution = .best
			box.image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
		} catch {
			// 无屏幕录制权限或窗口已消失：静默降级为无截图
		}
	}
	semaphore.wait()
	return box.image
}

func writePNG(_ image: CGImage, to path: String) -> Bool {
	let representation = NSBitmapImageRep(cgImage: image)
	guard let data = representation.representation(using: .png, properties: [:]) else { return false }
	return (try? data.write(to: URL(fileURLWithPath: path))) != nil
}

/// 把 NSImage（如 NSRunningApplication.icon）转成 CGImage 后落盘 PNG。失败静默
/// 返回 false，调用方降级为 iconPath=null，不算捕获失败。
func writeIconPNG(_ image: NSImage, to path: String) -> Bool {
	guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return false }
	return writePNG(cgImage, to: path)
}

// MARK: - 权限查询/请求

/// --check-permissions 与 --request-permissions 共用的 JSON shape：
/// {"accessibility":bool,"screenRecording":bool}，无 "ok" 字段，独立于捕获 shape。
func emitPermissions() -> Never {
	emit(
		[
			"accessibility": AXIsProcessTrusted(),
			"screenRecording": CGPreflightScreenCaptureAccess(),
		],
		exitCode: 0,
	)
}

// MARK: - CLI 参数

var outDirArg: String?
var noScreenshot = false
var excludePid: pid_t?
var checkPermissionsMode = false
var requestPermissionsMode = false

let arguments = Array(CommandLine.arguments.dropFirst())
var index = 0
while index < arguments.count {
	switch arguments[index] {
	case "--out-dir":
		index += 1
		if index < arguments.count { outDirArg = arguments[index] }
	case "--no-screenshot":
		noScreenshot = true
	case "--exclude-pid":
		index += 1
		if index < arguments.count, let pid = pid_t(arguments[index]) { excludePid = pid }
	case "--check-permissions":
		checkPermissionsMode = true
	case "--request-permissions":
		requestPermissionsMode = true
	default:
		fail("bad-args", "unknown argument: \(arguments[index])")
	}
	index += 1
}

if checkPermissionsMode {
	emitPermissions()
}

if requestPermissionsMode {
	_ = CGRequestScreenCaptureAccess()
	let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
	_ = AXIsProcessTrustedWithOptions([promptKey: true] as CFDictionary)
	emitPermissions()
}

guard let outDir = outDirArg else {
	fail("bad-args", "missing --out-dir")
}

// MARK: - 主流程

guard let frontmost = NSWorkspace.shared.frontmostApplication else {
	fail("no-frontmost", "no frontmost application")
}
let frontmostPid = frontmost.processIdentifier

if let excludePid, excludePid == frontmostPid {
	fail("self-capture", "frontmost application matches --exclude-pid")
}

let appName = frontmost.localizedName ?? ""
let bundleId = frontmost.bundleIdentifier ?? ""

// outDir 可能尚不存在：截图与 icon 都要落盘到这里，提前统一建好。
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

// 截图先做：AX 遍历慢/卡时也不拖累截图（两段仅共用 frontmostPid）。
// 截图走 ScreenCaptureKit，仅 macOS 14+；更旧系统降级为无截图（AX 文本仍可用）。
var pngPath: String?
if !noScreenshot, #available(macOS 14.0, *) {
	if let windowID = frontWindowID(for: frontmostPid),
		let image = captureWithScreenCaptureKit(windowID: windowID)
	{
		let path = (outDir as NSString).appendingPathComponent("capture.png")
		if writePNG(image, to: path) {
			pngPath = path
		}
	}
}

// App icon（NSRunningApplication.icon → PNG）。失败/无图标静默降级为 null，不算捕获失败。
var iconPath: String?
if let icon = frontmost.icon {
	let path = (outDir as NSString).appendingPathComponent("icon.png")
	if writeIconPNG(icon, to: path) {
		iconPath = path
	}
}

// AX：目标窗口 → 标题 / 源文件路径 / 结构化文本。无 AX 权限时全部为 nil。
// 对该应用的所有 AX 消息设 1s 超时，避免无响应应用把每次同步调用阻塞到父进程超时。
let axApp = AXUIElementCreateApplication(frontmostPid)
AXUIElementSetMessagingTimeout(axApp, 1.0)
let targetWindow = resolveTargetWindow(axApp)

var windowTitle = ""
var documentPath: String?
var axText: String?
if let targetWindow {
	windowTitle = axString(targetWindow, kAXTitleAttribute) ?? ""
	documentPath = documentPathOf(targetWindow)
	axText = collectAXText(from: targetWindow)
}

emit(
	[
		"ok": true,
		"appName": appName,
		"bundleId": bundleId,
		"windowTitle": windowTitle,
		"documentPath": orNull(documentPath),
		"axText": orNull(axText),
		"pngPath": orNull(pngPath),
		"iconPath": orNull(iconPath),
	],
	exitCode: 0,
)
