import Foundation
import Testing
@testable import VettaKit

/// The app ships English and Simplified Chinese and follows the system
/// language. These checks keep the catalog and the `L10n` keys in lockstep, so
/// a string added in one place but not the other fails here instead of showing
/// a raw key on the phone.
@Suite(.serialized) struct LocalizationTests {
	private static let languages = ["en", "zh-Hans"]
	private static let sources = URL(fileURLWithPath: #filePath)
		.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
		.appendingPathComponent("Sources/VettaKit")

	private func catalog() throws -> [String: [String: Any]] {
		let data = try Data(contentsOf: Self.sources.appendingPathComponent("Resources/Localizable.xcstrings"))
		let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
		return try #require(json["strings"] as? [String: [String: Any]])
	}

	/// Every translated value of one key, plural variants included.
	private func values(_ entry: [String: Any], _ language: String) -> [String] {
		guard let localization = (entry["localizations"] as? [String: Any])?[language] as? [String: Any] else { return [] }
		if let unit = localization["stringUnit"] as? [String: Any], let value = unit["value"] as? String { return [value] }
		let plural = (localization["variations"] as? [String: Any])?["plural"] as? [String: [String: Any]] ?? [:]
		return plural.values.compactMap { ($0["stringUnit"] as? [String: Any])?["value"] as? String }
	}

	private func specifiers(_ text: String) -> [String] {
		text.matches(of: /%(lld|@|d)/).map { String($0.output.0) }
	}

	@Test func everyKeyIsTranslatedInBothLanguagesWithMatchingArguments() throws {
		for (key, entry) in try catalog() {
			let expected = specifiers(key)
			for language in Self.languages {
				let texts = values(entry, language)
				#expect(!texts.isEmpty, "\(key) has no \(language) text")
				for text in texts {
					#expect(!text.isEmpty, "\(key) is empty in \(language)")
					#expect(specifiers(text) == expected, "\(key) in \(language) takes different arguments: \(text)")
				}
			}
		}
	}

	@Test func codeAndCatalogUseTheSameKeys() throws {
		let code = try String(contentsOf: Self.sources.appendingPathComponent("App/Strings.swift"), encoding: .utf8)
		let used = Set(code.matches(of: /tr\("([^"]+)"\)/).map { match in
			String(match.output.1).replacing(/\\\([^)]*\)/, with: "%lld")
		})
		let declared = Set(try catalog().keys)
		#expect(used.subtracting(declared).sorted() == [], "keys missing from Localizable.xcstrings")
		#expect(declared.subtracting(used).sorted() == [], "catalog keys no longer used")
	}

	@Test func resolvesEachLanguage() {
		defer { L10n.pin(language: nil) }
		L10n.pin(language: "zh-Hans")
		#expect(L10n.Home.title == "我的工作")
		#expect(L10n.Home.group(.waiting) == "待你决策")
		#expect(L10n.Link.reconnecting(3) == "正在重新连接（第 3 次）")
		#expect(L10n.Pair.troubleshootItems.count == 4)
		L10n.pin(language: "en")
		#expect(L10n.Home.title == "My Work")
		#expect(L10n.Home.group(.processing) == "In Progress")
		#expect(L10n.Link.latency(42) == "42 ms")
		#expect(L10n.Settings.loadValue(1) == "1 task running")
		#expect(L10n.Settings.loadValue(3) == "3 tasks running")
	}

	@Test func relativeTimeMatchesTheDesign() {
		defer { L10n.pin(language: nil) }
		let now = 10 * 86_400_000.0
		L10n.pin(language: "zh-Hans")
		#expect(TimeFormat.relative(now - 10_000, now: now) == "刚刚")
		#expect(TimeFormat.relative(now - 5 * 60_000, now: now) == "5分钟前")
		#expect(TimeFormat.relative(now - 30 * 60_000, now: now) == "半小时前")
		#expect(TimeFormat.relative(now - 50 * 60_000, now: now) == "50分钟前")
		#expect(TimeFormat.relative(now - 3 * 3_600_000, now: now) == "3小时前")
		#expect(TimeFormat.relative(now - 49 * 3_600_000, now: now) == "2天前")
		L10n.pin(language: "en")
		#expect(TimeFormat.relative(now - 10_000, now: now) == "Just now")
		#expect(TimeFormat.relative(now - 5 * 60_000, now: now) == "5 min ago")
		#expect(TimeFormat.relative(now - 60 * 60_000, now: now) == "1 hour ago")
		#expect(TimeFormat.relative(now - 3 * 3_600_000, now: now) == "3 hours ago")
		#expect(TimeFormat.relative(now - 49 * 3_600_000, now: now) == "2 days ago")
	}
}
