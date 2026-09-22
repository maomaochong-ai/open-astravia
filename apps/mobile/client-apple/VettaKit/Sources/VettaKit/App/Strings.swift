import Foundation

/// All user-visible copy. Chinese is the source of truth (it is what the design
/// specifies); other locales can be layered on later by mapping these keys.
public enum L10n {
	public static let appName = "Vetta"

	public enum Common {
		public static let back = "返回"
		public static let close = "关闭"
		public static let cancel = "取消"
		public static let confirm = "确认"
		public static let retry = "重试"
		public static let comingSoon = "即将推出"
		public static let offline = "电脑离线"
		public static let connecting = "连接中"
		public static let online = "已安全连接"
		public static let justNow = "刚刚"
		public static func minutesAgo(_ n: Int) -> String { "\(n)分钟前" }
		public static func hoursAgo(_ n: Int) -> String { "\(n)小时前" }
		public static let halfHourAgo = "半小时前"
		public static func daysAgo(_ n: Int) -> String { "\(n)天前" }
		public static let today = "今天"
		public static let unknownError = "出了点问题，请稍后再试"
		public static let notConnected = "电脑当前不在线，重新连上后再试"
	}

	public enum Home {
		public static let title = "电脑正在做的事"
		public static let subtitle = "手机随时查看进度，不用守在电脑前"
		public static let processing = "个处理中"
		public static let done = "个已办结"
		public static let remoteDesktop = "远程桌面"
		public static let remoteDesktopHint = "低延迟同屏"
		public static let sshTerminal = "SSH终端"
		public static let sshTerminalHint = "命令行调试"
		public static let searchPlaceholder = "搜索对话或任务..."
		public static let filterAll = "全部"
		public static func filterProcessing(_ n: Int) -> String { "处理中 (\(n))" }
		public static let filterDone = "已办结"
		public static let composerPlaceholder = "向电脑发个新任务或提问..."
		public static let empty = "还没有对话。给电脑发个任务试试。"
		public static let emptyFiltered = "没有匹配的对话"
		public static let offlineBanner = "电脑离线，显示的是上次同步的内容"
		public static let statusRunning = "进行中"
		public static let statusThinking = "思考中"
		public static let statusWaiting = "需要你确认"
		public static let statusDone = "已完成"
		public static let statusError = "出错"
		public static let statusAborted = "已停止"
		public static let untitled = "未命名对话"
	}

	public enum Chat {
		public static let assistant = "Vetta Assistant"
		public static let composerPlaceholder = "继续追问，或向电脑下发补充指令..."
		public static let thinking = "思考过程"
		public static let thinkingLive = "正在思考"
		public static let toolDone = "已完成"
		public static let toolFailed = "失败"
		public static let toolRunning = "执行中"
		public static let toolGenerating = "准备中"
		public static let stop = "停止"
		public static let send = "发送"
		public static let resync = "重新同步"
		public static let summaryDone = "已完成全部检索与汇总"
		public static let summaryRunning = "正在处理"
		public static let questionTitle = "需要你确认"
		public static let questionSkip = "暂不回答"
		public static let questionSubmit = "提交"
		public static let loadingHistory = "正在读取对话..."
		public static let errorPrefix = "出错："
		public static let compacted = "上下文已压缩"
	}

	public enum Settings {
		public static let title = "设置"
		public static let heading = "连接与偏好"
		public static let subheading = "管理与电脑的同步状态及手机操作权限"
		public static let myComputer = "我的电脑"
		public static let rescan = "重新扫码"
		public static let connectionState = "连接状态"
		public static func excellent(_ ms: Int) -> String { "极佳 (\(ms)ms)" }
		public static func good(_ ms: Int) -> String { "良好 (\(ms)ms)" }
		public static func fair(_ ms: Int) -> String { "一般 (\(ms)ms)" }
		public static let offline = "离线"
		public static let viaLan = "局域网直连"
		public static let viaRelay = "云端中继"
		public static let load = "电脑负荷"
		public static func loadValue(_ n: Int) -> String { "\(n) 个任务处理中" }
		public static let loadIdle = "空闲"
		public static let confirmPolicy = "手机确认策略"
		public static let confirmPolicyHint = "当电脑在改动重要文件时，何时提醒你在手机上确认"
		public static let policyMajor = "只在重大变动"
		public static let policyImportant = "重要操作确认"
		public static let policyAuto = "全自动执行"
		public static let liveThinking = "实时看到电脑思考"
		public static let liveThinkingHint = "电脑打字或分析时，文字在手机上同步跳动"
		public static let haptics = "任务做完震动提醒"
		public static let hapticsHint = "电脑办结长任务或需要你确认时通知"
		public static let biometric = "面容 / 指纹解锁确认"
		public static let biometricHint = "批准删除重要文件时使用生物识别验证"
		public static let unpair = "解除配对"
		public static let unpairHint = "删除这台电脑的连接凭据和本机缓存"
		public static let unpairConfirm = "解除与这台电脑的配对？手机上缓存的对话会一起删除。"
		public static let noComputer = "尚未连接电脑"
	}

	public enum Pair {
		public static let title = "连接电脑"
		public static let scanHint = "对准电脑端的二维码"
		public static let scanDescription = "打开电脑上的 Vetta Desktop，点击右上角「手机扫码连接」即可快速绑定"
		public static let listening = "正在监听局域网中的 Vetta 节点..."
		public static let manual = "手动输入配对码或 IP"
		public static let troubleshoot = "扫码无法识别？查看排查指引"
		public static let cameraDenied = "需要相机权限才能扫码"
		public static let cameraUnavailable = "这台设备没有可用的相机"
		public static let grantCamera = "允许使用相机"
		public static let invalidCode = "这不是 Vetta 的配对码"
		public static let connecting = "正在连接电脑..."
		public static let waitingApproval = "在电脑上核对验证码并点击「允许」"
		public static let verificationCode = "验证码"
		public static let codeHint = "两边显示的数字一致才是你的电脑"
		public static let manualTitle = "手动连接"
		public static let manualHint = "输入电脑端显示的 IP 和端口，例如 192.168.1.20:43117"
		public static let manualPlaceholder = "IP:端口"
		public static let manualInvalid = "请输入形如 192.168.1.20:43117 的地址"
		public static let connect = "连接"
		public static let rejected = "电脑拒绝了这次配对"
		public static let unauthorized = "电脑不认识这部手机，请重新扫码"
		public static let failed = "连不上电脑，请检查是否在同一 Wi-Fi"
		public static let troubleshootTitle = "排查指引"
		public static let troubleshootItems = [
			"手机和电脑要在同一个 Wi-Fi 下，访客网络通常会隔离设备。",
			"iPhone 首次连接会询问「本地网络」权限，请选择允许；拒绝后可到 设置 → Vetta 里重新打开。",
			"Mac 第一次开启手机连接时会弹出防火墙提示，请点「允许」。",
			"电脑端二维码里带有局域网地址和云端中继地址，局域网连不上时会自动改走中继。",
		]

		public static func describe(_ failure: PairingFailure) -> String {
			switch failure {
			case .invalidCode: invalidCode
			case .rejected: rejected
			case .unauthorized: unauthorized
			case .invalidEndpoint: manualInvalid
			case .unreachable: failed
			}
		}
	}
}

public enum TimeFormat {
	public static func relative(_ timestamp: Double, now: Double = WallClock.nowMs()) -> String {
		let diff = max(0, now - timestamp)
		let minutes = Int(diff / 60_000)
		if minutes < 1 { return L10n.Common.justNow }
		if minutes < 25 { return L10n.Common.minutesAgo(minutes) }
		if minutes < 45 { return L10n.Common.halfHourAgo }
		let hours = minutes / 60
		if hours < 1 { return L10n.Common.minutesAgo(minutes) }
		if hours < 24 { return L10n.Common.hoursAgo(hours) }
		return L10n.Common.daysAgo(hours / 24)
	}

	public static func clock(_ timestamp: Double) -> String {
		let date = Date(timeIntervalSince1970: timestamp / 1000)
		let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
		return String(format: "%@ %02d:%02d", L10n.Common.today, parts.hour ?? 0, parts.minute ?? 0)
	}
}
