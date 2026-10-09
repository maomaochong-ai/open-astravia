import Foundation

/// A reply's markdown as it should sound: code blocks, tables' rules, links'
/// addresses and markup are dropped, the words around them kept.
public enum SpeakableText {
	public nonisolated static func plain(_ markdown: some StringProtocol) -> String {
		var lines: [String] = []
		var fenced = false
		for raw in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
			let line = raw.trimmingCharacters(in: .whitespaces)
			if isFence(line) {
				fenced.toggle()
				continue
			}
			if fenced || isRule(line) { continue }
			let spoken = inline(blockMarker(line))
			if !spoken.isEmpty { lines.append(spoken) }
		}
		return lines.joined(separator: "\n")
	}

	/// How far a reply still being written can be read: up to the last finished
	/// sentence or line, never into a code block or a link not yet closed.
	public nonisolated static func boundary(_ text: String, from start: String.Index) -> String.Index {
		var safe = start
		var fenced = false
		var lineStart = text.startIndex
		while lineStart < text.endIndex {
			guard let newline = text[lineStart...].firstIndex(of: "\n") else {
				// The line still being written.
				if !fenced, !mayBeFence(text[lineStart...]) {
					safe = max(safe, sentenceEnd(in: text[lineStart...]) ?? safe)
				}
				break
			}
			let line = text[lineStart ..< newline].trimmingCharacters(in: .whitespaces)
			if isFence(line) { fenced.toggle() }
			lineStart = text.index(after: newline)
			if !fenced, lineStart > start { safe = lineStart }
		}
		return safe
	}

	private nonisolated static func isFence(_ line: String) -> Bool {
		line.hasPrefix("```") || line.hasPrefix("~~~")
	}

	/// A partial line that could still turn into a fence once more arrives.
	private nonisolated static func mayBeFence(_ line: Substring) -> Bool {
		let head = line.drop { $0 == " " }.prefix(3)
		return !head.isEmpty && (head.allSatisfy { $0 == "`" } || head.allSatisfy { $0 == "~" })
	}

	/// Horizontal rules, a table's header rule, and lines of bare markup.
	private nonisolated static func isRule(_ line: String) -> Bool {
		!line.isEmpty && line.allSatisfy { "-*_=|: ".contains($0) }
	}

	private nonisolated static func blockMarker(_ line: String) -> String {
		var text = line
		text = text.replacing(/^(>\s*)+/, with: "")
		text = text.replacing(/^#{1,6}\s+/, with: "")
		text = text.replacing(/^([-*+]|\d+[.)])\s+/, with: "")
		text = text.replacing(/^\[[ xX]\]\s+/, with: "")
		if text.hasPrefix("|") {
			let cells = text.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
			text = cells.joined(separator: ", ")
		}
		return text
	}

	private nonisolated static func inline(_ line: String) -> String {
		var text = line
		text = text.replacing(/!\[[^\]]*\]\([^)]*\)/, with: "")
		text = text.replacing(/\[([^\]]*)\]\([^)]*\)/) { String($0.output.1) }
		text = text.replacing(/<https?:[^>]*>/, with: "")
		text = text.replacing(/https?:\/\/\S+/, with: "")
		text = text.replacing(/<\/?[A-Za-z][^>]*>/, with: "")
		text = text.replacing(/`+/, with: "")
		text = text.replacing(/\*+|~~|__/, with: "")
		text = text.replacing(/[ \t]{2,}/, with: " ")
		return text.trimmingCharacters(in: .whitespaces)
	}

	/// Past the last sentence end in a line still being written, where the markup
	/// before it is closed: cutting inside `code` or a [link](…) mangles both halves.
	private nonisolated static func sentenceEnd(in line: Substring) -> String.Index? {
		var found: String.Index?
		var ticks = 0
		var brackets = 0
		var parens = 0
		var index = line.startIndex
		var previous: Character?
		while index < line.endIndex {
			let char = line[index]
			let next = line.index(after: index)
			switch char {
			case "`": ticks += 1
			case "[": brackets += 1
			case "]": brackets = max(0, brackets - 1)
			case "(": parens += 1
			case ")": parens = max(0, parens - 1)
			default: break
			}
			if ticks % 2 == 0, brackets == 0, parens == 0 {
				if "。！？；…".contains(char) {
					found = next
				} else if ".!?;".contains(char), next < line.endIndex, line[next].isWhitespace,
				          !(char == "." && previous?.isNumber == true) {
					found = next
				}
			}
			previous = char
			index = next
		}
		return found
	}
}

/// The latest turn's text pieces, which reading follows as they grow.
public struct SpeechSource: Equatable, Sendable {
	public struct Piece: Equatable, Sendable {
		public var id: String
		public var text: String

		public nonisolated init(id: String, text: String) {
			self.id = id
			self.text = text
		}
	}

	public var turnId: String
	public var texts: [Piece]
	public var streaming: Bool

	public nonisolated init(turnId: String, texts: [Piece], streaming: Bool) {
		self.turnId = turnId
		self.texts = texts
		self.streaming = streaming
	}

	/// The latest turn among the chat's rows.
	public nonisolated static func latest(_ rows: [ChatLine]) -> SpeechSource? {
		guard let head = rows.lastIndex(where: { if case .head = $0 { true } else { false } }),
		      case let .head(id, _, streaming, _, _) = rows[head]
		else { return nil }
		let texts: [Piece] = rows[head...].compactMap {
			if case let .piece(.text(id, text), _, _, _) = $0 { Piece(id: id, text: text) } else { nil }
		}
		return SpeechSource(turnId: id, texts: texts, streaming: streaming)
	}
}

/// Follows the reply being written and hands out what can be read next, a
/// sentence or line at a time, so reading starts long before the reply ends.
public struct SpeechFeed: Sendable {
	public private(set) var turnId: String?
	/// How much of each text piece has been handed out.
	private var read: [String: String.Index] = [:]
	/// The turn is over and everything in it was handed out.
	private var done = false

	public init() {}

	/// What to read next of the latest turn. A turn first seen already finished is
	/// history and stays silent; one first seen midway is read from its latest text.
	public mutating func next(_ source: SpeechSource) -> [String] {
		let texts = source.texts
		if source.turnId != turnId {
			let placeholder = turnId == ChatTurns.pendingTurnId
			turnId = source.turnId
			read = [:]
			done = !source.streaming && !placeholder
			if done { return [] }
			if !placeholder {
				for piece in texts.dropLast() { read[piece.id] = piece.text.endIndex }
			}
		}
		guard !done else { return [] }
		var out: [String] = []
		for (index, piece) in texts.enumerated() {
			let start = read[piece.id].map { min($0, piece.text.endIndex) } ?? piece.text.startIndex
			let open = source.streaming && index == texts.count - 1
			let end = open ? SpeakableText.boundary(piece.text, from: start) : piece.text.endIndex
			guard end > start else { continue }
			read[piece.id] = end
			let spoken = SpeakableText.plain(piece.text[start ..< end])
			if !spoken.isEmpty { out.append(spoken) }
		}
		if !source.streaming { done = true }
		return out
	}
}
