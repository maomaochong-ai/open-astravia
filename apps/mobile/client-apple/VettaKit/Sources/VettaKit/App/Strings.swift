import Foundation

/// All user-visible copy. The text lives in `Resources/Localizable.xcstrings`
/// (English and Simplified Chinese) and follows the system language; every
/// accessor here is only a key into that catalog.
public enum L10n {
	public static let appName = "Vetta"

	/// Where lookups resolve, and the locale that picks plural forms. Tests pin
	/// one language with `pin(language:)`.
	static var bundle = Bundle.module
	static var locale = Locale.current

	/// Forces one `.lproj` (e.g. "en", "zh-Hans"); `nil` goes back to the system language.
	static func pin(language: String?) {
		bundle = language
			.flatMap { Bundle.module.path(forResource: $0, ofType: "lproj") }
			.flatMap(Bundle.init(path:)) ?? .module
		locale = language.map(Locale.init(identifier:)) ?? .current
	}

	public enum Common {
		public static var back: String { tr("common.back") }
		public static var close: String { tr("common.close") }
		public static var cancel: String { tr("common.cancel") }
		public static var confirm: String { tr("common.confirm") }
		public static var done: String { tr("common.done") }
		public static var save: String { tr("common.save") }
		public static var retry: String { tr("common.retry") }
		public static var offline: String { tr("common.offline") }
		public static var connecting: String { tr("common.connecting") }
		public static var online: String { tr("common.online") }
		public static var justNow: String { tr("common.justNow") }
		public static func minutesAgo(_ n: Int) -> String { tr("common.minutesAgo \(n)") }
		public static func hoursAgo(_ n: Int) -> String { tr("common.hoursAgo \(n)") }
		public static var halfHourAgo: String { tr("common.halfHourAgo") }
		public static func daysAgo(_ n: Int) -> String { tr("common.daysAgo \(n)") }
		public static var today: String { tr("common.today") }
		public static var unknownError: String { tr("common.unknownError") }
		public static var notConnected: String { tr("common.notConnected") }
	}

	public enum Home {
		public static var title: String { tr("home.title") }
		public static var filterStatus: String { tr("home.filterStatus") }
		public static var statusAll: String { tr("home.statusAll") }
		public static var groupWaiting: String { tr("home.groupWaiting") }
		public static var groupProcessing: String { tr("home.groupProcessing") }
		public static var groupDone: String { tr("home.groupDone") }
		public static var kindProject: String { tr("home.kindProject") }
		public static var conversation: String { tr("home.conversation") }
		public static var empty: String { tr("home.empty") }
		public static var emptyDescription: String { tr("home.emptyDescription") }
		public static var emptyFiltered: String { tr("home.emptyFiltered") }
		public static var emptyFilteredDescription: String { tr("home.emptyFilteredDescription") }
		public static var clearFilters: String { tr("home.clearFilters") }
		public static var statusRunning: String { tr("home.statusRunning") }
		public static var statusThinking: String { tr("home.statusThinking") }
		public static var statusWaiting: String { tr("home.statusWaiting") }
		public static var statusDone: String { tr("home.statusDone") }
		public static var statusError: String { tr("home.statusError") }
		public static var statusAborted: String { tr("home.statusAborted") }
		public static var untitled: String { tr("home.untitled") }
		public static var unpairedTitle: String { tr("home.unpairedTitle") }
		public static var unpairedDescription: String { tr("home.unpairedDescription") }
		public static var unpairedScan: String { tr("home.unpairedScan") }
		public static var search: String { tr("home.search") }
		public static var taskBoard: String { tr("home.taskBoard") }
		public static var tasks: String { tr("home.tasks") }
		public static var pickProject: String { tr("home.pickProject") }
		public static var allSessions: String { tr("home.allSessions") }
		public static var searchPlaceholder: String { tr("home.searchPlaceholder") }
		public static func sessionCount(_ n: Int) -> String { tr("home.sessionCount \(n)") }
		public static func updated(_ time: String) -> String { tr("home.updated \(time)") }
		public static var noProjects: String { tr("home.noProjects") }
		public static var noProjectsDescription: String { tr("home.noProjectsDescription") }

		public static func group(_ group: SessionStatusGroup) -> String {
			switch group {
			case .waiting: groupWaiting
			case .processing: groupProcessing
			case .done: groupDone
			}
		}
	}

	public enum Link {
		public static var status: String { tr("link.status") }
		public static var connected: String { tr("link.connected") }
		public static var connecting: String { tr("link.connecting") }
		public static func reconnecting(_ attempt: Int) -> String { tr("link.reconnecting \(attempt)") }
		public static var reconnect: String { tr("link.reconnect") }
		public static func latency(_ ms: Int) -> String { tr("link.latency \(ms)") }
	}

	public enum NewSession {
		public static var title: String { tr("newSession.title") }
		public static var greeting: String { tr("newSession.greeting") }
		public static var subtitle: String { tr("newSession.subtitle") }
		public static var defaultModel: String { tr("newSession.defaultModel") }
		public static var defaultModelHint: String { tr("newSession.defaultModelHint") }
		public static var offline: String { tr("newSession.offline") }
		public static var connecting: String { tr("newSession.connecting") }
		public static var location: String { tr("newSession.location") }
	}

	/// What can be done to a session, from the chat's More menu and the list's swipe.
	public enum Session {
		public static var rename: String { tr("session.rename") }
		public static var renameTitle: String { tr("session.renameTitle") }
		public static var pin: String { tr("session.pin") }
		public static var unpin: String { tr("session.unpin") }
		public static var pinned: String { tr("session.pinned") }
		public static var delete: String { tr("session.delete") }
		public static var deleteTitle: String { tr("session.deleteTitle") }
		public static var deleteMessage: String { tr("session.deleteMessage") }
	}

	public enum Chat {
		public static var composerPlaceholder: String { tr("chat.composerPlaceholder") }
		public static var thinking: String { tr("chat.thinking") }
		public static var thinkingLive: String { tr("chat.thinkingLive") }
		public static var toolDone: String { tr("chat.toolDone") }
		public static var toolFailed: String { tr("chat.toolFailed") }
		public static var toolRunning: String { tr("chat.toolRunning") }
		public static var toolGenerating: String { tr("chat.toolGenerating") }
		public static var stop: String { tr("chat.stop") }
		public static var send: String { tr("chat.send") }
		public static var resync: String { tr("chat.resync") }
		public static var more: String { tr("chat.more") }
		public static var working: String { tr("chat.working") }
		public static var waitingModel: String { tr("chat.waitingModel") }
		public static func retrying(_ attempt: Int, _ total: Int) -> String { tr("chat.retrying \(attempt) \(total)") }
		public static var compacting: String { tr("chat.compacting") }

		/// The desktop's `session.state.detail` ("retry 1/3", "compacting") in the phone's language.
		public static func activity(_ detail: String?) -> String? {
			guard let detail else { return nil }
			if detail == "compacting" { return compacting }
			if let match = detail.wholeMatch(of: /retry (\d+)\/(\d+)/), let attempt = Int(match.1), let total = Int(match.2) {
				return retrying(attempt, total)
			}
			return nil
		}
		public static func stepsDone(_ n: Int) -> String { tr("chat.stepsDone \(n)") }
		public static func thinkingActivity(_ text: String) -> String { tr("chat.thinkingActivity \(text)") }
		public static var copy: String { tr("chat.copy") }
		public static var copied: String { tr("chat.copied") }
		public static var questionTitle: String { tr("chat.questionTitle") }
		public static var attach: String { tr("chat.attach") }
		public static var attachPhotos: String { tr("chat.attachPhotos") }
		public static var attachFiles: String { tr("chat.attachFiles") }
		public static var attachCamera: String { tr("chat.attachCamera") }
		public static var attachFilesHint: String { tr("chat.attachFilesHint") }
		public static var attachRecent: String { tr("chat.attachRecent") }
		public static var cameraUnavailable: String { tr("chat.cameraUnavailable") }
		public static var dictationHint: String { tr("chat.dictationHint") }
		public static var dictationCancel: String { tr("chat.dictationCancel") }
		public static var dictationListening: String { tr("chat.dictationListening") }
		public static var dictationDenied: String { tr("chat.dictationDenied") }
		public static var dictationUnavailable: String { tr("chat.dictationUnavailable") }
		public static func attachTooLarge(_ name: String) -> String { tr("chat.attachTooLarge \(name)") }
		public static func attachTooMany(_ n: Int) -> String { tr("chat.attachTooMany \(n)") }
		public static func removeAttachment(_ name: String) -> String { tr("chat.removeAttachment \(name)") }
		public static var model: String { tr("chat.model") }
		public static var modelsLoading: String { tr("chat.modelsLoading") }
		public static var thinkingLevel: String { tr("chat.thinkingLevel") }

		/// Known provider effort values get a name; anything else shows as the desktop sent it.
		public static func level(_ value: String) -> String {
			switch value {
			case "off": tr("chat.level.off")
			case "none": tr("chat.level.none")
			case "minimal": tr("chat.level.minimal")
			case "low": tr("chat.level.low")
			case "medium": tr("chat.level.medium")
			case "high": tr("chat.level.high")
			case "xhigh": tr("chat.level.xhigh")
			case "max": tr("chat.level.max")
			default: value
			}
		}

		public static var questionNext: String { tr("chat.questionNext") }
		public static var questionMultiHint: String { tr("chat.questionMultiHint") }
		public static var questionOther: String { tr("chat.questionOther") }
		public static var questionOtherPlaceholder: String { tr("chat.questionOtherPlaceholder") }
		public static func questionTab(_ n: Int) -> String { tr("chat.questionTab \(n)") }
		public static var questionSubmit: String { tr("chat.questionSubmit") }
		public static var loadingHistory: String { tr("chat.loadingHistory") }
		public static var errorPrefix: String { tr("chat.errorPrefix") }
		public static var compacted: String { tr("chat.compacted") }
	}

	public enum Settings {
		public static var title: String { tr("settings.title") }
		public static var rescan: String { tr("settings.rescan") }
		public static var scanToConnect: String { tr("settings.scanToConnect") }
		public static var latency: String { tr("settings.latency") }
		public static var viaLan: String { tr("settings.viaLan") }
		public static var viaRelay: String { tr("settings.viaRelay") }
		public static var load: String { tr("settings.load") }
		public static func loadValue(_ n: Int) -> String { tr("settings.loadValue \(n)") }
		public static var loadIdle: String { tr("settings.loadIdle") }
		public static var confirmPolicy: String { tr("settings.confirmPolicy") }
		public static var confirmPolicyHint: String { tr("settings.confirmPolicyHint") }
		public static var policyMajor: String { tr("settings.policyMajor") }
		public static var policyImportant: String { tr("settings.policyImportant") }
		public static var policyAuto: String { tr("settings.policyAuto") }
		public static var liveThinking: String { tr("settings.liveThinking") }
		public static var haptics: String { tr("settings.haptics") }
		public static var unpair: String { tr("settings.unpair") }
		public static var unpairHint: String { tr("settings.unpairHint") }
		public static var unpairConfirm: String { tr("settings.unpairConfirm") }
	}

	public enum Pair {
		public static var title: String { tr("pair.title") }
		public static var scanHint: String { tr("pair.scanHint") }
		public static var scanDescription: String { tr("pair.scanDescription") }
		public static var listening: String { tr("pair.listening") }
		public static var manual: String { tr("pair.manual") }
		public static var troubleshoot: String { tr("pair.troubleshoot") }
		public static var cameraDenied: String { tr("pair.cameraDenied") }
		public static var cameraUnavailable: String { tr("pair.cameraUnavailable") }
		public static var grantCamera: String { tr("pair.grantCamera") }
		public static var invalidCode: String { tr("pair.invalidCode") }
		public static var connecting: String { tr("pair.connecting") }
		public static var waitingApproval: String { tr("pair.waitingApproval") }
		public static var verificationCode: String { tr("pair.verificationCode") }
		public static var codeHint: String { tr("pair.codeHint") }
		public static var manualTitle: String { tr("pair.manualTitle") }
		public static var manualHint: String { tr("pair.manualHint") }
		public static var manualPlaceholder: String { tr("pair.manualPlaceholder") }
		public static var manualInvalid: String { tr("pair.manualInvalid") }
		public static var connect: String { tr("pair.connect") }
		public static var rejected: String { tr("pair.rejected") }
		public static var unauthorized: String { tr("pair.unauthorized") }
		public static var failed: String { tr("pair.failed") }
		public static var troubleshootTitle: String { tr("pair.troubleshootTitle") }
		public static var troubleshootItems: [String] {
			[
				tr("pair.troubleshoot.sameWifi"),
				tr("pair.troubleshoot.localNetwork"),
				tr("pair.troubleshoot.firewall"),
				tr("pair.troubleshoot.relay"),
			]
		}

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

private func tr(_ key: String.LocalizationValue) -> String {
	String(localized: key, bundle: L10n.bundle, locale: L10n.locale)
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
