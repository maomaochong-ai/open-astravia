import Foundation

/// A skill or scene the prompt refers to. On the wire it is a token at the
/// start of the text, `@skill:name` or `@scene:name`, the same form the
/// desktop composer writes; the desktop turns a scene into its prompt resource.
public struct SkillReference: Hashable, Identifiable, Sendable {
	public var kind: RemoteSkillOption.Kind
	public var name: String

	public init(kind: RemoteSkillOption.Kind, name: String) {
		self.kind = kind
		self.name = name
	}

	public var id: String { "\(kind.rawValue):\(name)" }

	/// Names without whitespace or quotes go bare; anything else is quoted, quotes dropped.
	public var token: String {
		let bare = !name.isEmpty && !name.contains { $0.isWhitespace || $0 == "\"" }
		return "@\(kind.rawValue):" + (bare ? name : "\"\(name.replacingOccurrences(of: "\"", with: ""))\"")
	}
}

public enum SkillTokens {
	/// The prompt the desktop receives: the references first, then what the user typed.
	public static func prompt(_ skills: [SkillReference], _ text: String) -> String {
		(skills.map(\.token) + (text.isEmpty ? [] : [text])).joined(separator: " ")
	}

	/// The references a message starts with, and the text after them. Tokens
	/// later in the text are left as they are: pulling them out mid-sentence
	/// would leave the sentence with a hole.
	public static func split(_ text: String) -> (skills: [SkillReference], body: String) {
		var rest = Substring(text)
		var skills: [SkillReference] = []
		while true {
			let trimmed = rest.drop { $0.isWhitespace }
			guard let (skill, after) = leadingToken(trimmed) else { break }
			if !skills.contains(skill) { skills.append(skill) }
			rest = after
		}
		guard !skills.isEmpty else { return ([], text) }
		return (skills, String(rest.drop { $0.isWhitespace }))
	}

	/// Characters that end a bare name, as the desktop's parser has them.
	private static let bareStop: Set<Character> = ["\"", "。", "，", "、", "；", "：", "！", "？", "（", "）", "【", "】", "「", "」", "『", "』"]

	private static func leadingToken(_ text: Substring) -> (SkillReference, Substring)? {
		guard text.first == "@" else { return nil }
		let afterAt = text.dropFirst()
		for kind in [RemoteSkillOption.Kind.skill, .scene] {
			let prefix = "\(kind.rawValue):"
			guard afterAt.hasPrefix(prefix) else { continue }
			let value = afterAt.dropFirst(prefix.count)
			let name: Substring
			let after: Substring
			if value.first == "\"" {
				let quoted = value.dropFirst()
				guard let close = quoted.firstIndex(of: "\"") else { return nil }
				name = quoted[..<close]
				after = quoted[quoted.index(after: close)...]
			} else {
				let end = value.firstIndex { $0.isWhitespace || bareStop.contains($0) } ?? value.endIndex
				name = value[..<end]
				after = value[end...]
			}
			guard !name.isEmpty else { return nil }
			return (SkillReference(kind: kind, name: String(name)), after)
		}
		return nil
	}
}

/// One project's skill list as the picker shows it.
public struct SkillCatalog: Equatable, Sendable {
	/// Nil until the first list arrives.
	public var options: [RemoteSkillOption]?
	public var loading = false
	/// The last fetch failed; `options` still holds the list before it, if any.
	public var failed = false

	public init(options: [RemoteSkillOption]? = nil, loading: Bool = false, failed: Bool = false) {
		self.options = options
		self.loading = loading
		self.failed = failed
	}
}

public extension [RemoteSkillOption] {
	/// The picker's search: name, display name or description, ignoring case
	/// and diacritics; the desktop's order is kept.
	func matching(_ query: String) -> [RemoteSkillOption] {
		let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !query.isEmpty else { return self }
		return filter { option in
			[option.name, option.alias ?? "", option.description].contains { $0.localizedStandardContains(query) }
		}
	}
}
