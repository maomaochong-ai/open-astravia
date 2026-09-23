import SwiftUI
import VettaKit

/// Block-level Markdown for assistant replies: headings, lists, fenced code,
/// quotes, rules and tables, with inline styling from Foundation's parser.
struct MarkdownView: View {
	var text: String

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			ForEach(Array(MarkdownBlock.parse(text).enumerated()), id: \.offset) { _, block in
				view(for: block)
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
	}

	@ViewBuilder
	private func view(for block: MarkdownBlock) -> some View {
		switch block {
		case let .heading(level, content):
			Text(Self.inline(content))
				.font(.system(size: level == 1 ? 20 : level == 2 ? 18 : 16, weight: level <= 2 ? .bold : .semibold))
				.foregroundStyle(Theme.ink)
		case let .paragraph(content):
			Self.body(content)
		case let .bullets(items):
			VStack(alignment: .leading, spacing: 4) {
				ForEach(Array(items.enumerated()), id: \.offset) { _, item in
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						Text("•").font(.system(size: 15)).foregroundStyle(Theme.dim)
						Self.body(item)
					}
				}
			}
		case let .ordered(items):
			VStack(alignment: .leading, spacing: 4) {
				ForEach(Array(items.enumerated()), id: \.offset) { _, item in
					HStack(alignment: .firstTextBaseline, spacing: 8) {
						Text("\(item.number).").font(.system(size: 15)).foregroundStyle(Theme.dim).monospacedDigit()
						Self.body(item.text)
					}
				}
			}
		case let .code(content):
			ScrollView(.horizontal, showsIndicators: false) {
				Text(content)
					.font(.mono(12.5))
					.foregroundStyle(Theme.ink)
					.textSelection(.enabled)
					.fixedSize(horizontal: true, vertical: false)
					.padding(12)
			}
			.background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
			.overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
		case let .quote(content):
			HStack(spacing: 10) {
				Rectangle().fill(Theme.faint).frame(width: 2)
				Self.body(content)
			}
			.padding(.horizontal, 12)
			.padding(.vertical, 6)
			.background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.card))
			.fixedSize(horizontal: false, vertical: true)
		case .rule:
			Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 4)
		case let .table(header, rows):
			MarkdownTable(header: header, rows: rows)
		}
	}

	static func body(_ content: String) -> some View {
		Text(inline(content))
			.font(.system(size: 15))
			.foregroundStyle(Theme.ink)
			.lineSpacing(5)
			.textSelection(.enabled)
			.fixedSize(horizontal: false, vertical: true)
	}

	/// Inline Markdown with the design's inline-code treatment (mono on a soft chip).
	static func inline(_ content: String) -> AttributedString {
		var attributed = (try? AttributedString(
			markdown: content,
			options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
		)) ?? AttributedString(content)
		for run in attributed.runs {
			if run.inlinePresentationIntent?.contains(.code) == true {
				attributed[run.range].font = .mono(13)
				attributed[run.range].foregroundColor = Theme.ink
				attributed[run.range].backgroundColor = Theme.card2
			}
			if run.link != nil {
				attributed[run.range].foregroundColor = Theme.ink
				attributed[run.range].underlineStyle = .single
			}
		}
		return attributed
	}
}

private struct MarkdownTable: View {
	var header: [String]
	var rows: [[String]]

	var body: some View {
		ScrollView(.horizontal, showsIndicators: false) {
			Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
				GridRow {
					ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
						Text(MarkdownView.inline(cell))
							.font(.system(size: 12, weight: .medium))
							.foregroundStyle(Theme.dim)
							.padding(.horizontal, 12)
							.padding(.vertical, 9)
							.frame(maxWidth: .infinity, alignment: .leading)
					}
				}
				.background(Theme.card)
				ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
					Divider().overlay(Theme.line)
					GridRow {
						ForEach(0 ..< header.count, id: \.self) { index in
							Text(MarkdownView.inline(index < row.count ? row[index] : ""))
								.font(.mono(13))
								.foregroundStyle(Theme.ink)
								.padding(.horizontal, 12)
								.padding(.vertical, 10)
								.frame(maxWidth: .infinity, alignment: .leading)
						}
					}
				}
			}
			.fixedSize(horizontal: true, vertical: false)
			.frame(minWidth: 0)
			.clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
			.overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
		}
	}
}

enum MarkdownBlock: Equatable {
	case heading(Int, String)
	case paragraph(String)
	case bullets([String])
	case ordered([OrderedItem])
	case code(String)
	case quote(String)
	case rule
	case table(header: [String], rows: [[String]])

	struct OrderedItem: Equatable {
		var number: Int
		var text: String
	}

	static func parse(_ text: String) -> [MarkdownBlock] {
		let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
		var blocks: [MarkdownBlock] = []
		var paragraph: [String] = []
		var index = 0

		func flushParagraph() {
			if !paragraph.isEmpty {
				blocks.append(.paragraph(paragraph.joined(separator: "\n")))
				paragraph.removeAll()
			}
		}

		while index < lines.count {
			let line = lines[index]
			let trimmed = line.trimmingCharacters(in: .whitespaces)
			if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
				flushParagraph()
				let fence = String(trimmed.prefix(3))
				var body: [String] = []
				index += 1
				while index < lines.count, !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
					body.append(lines[index])
					index += 1
				}
				blocks.append(.code(body.joined(separator: "\n")))
				index += 1
				continue
			}
			if trimmed.isEmpty {
				flushParagraph()
				index += 1
				continue
			}
			if let heading = headingLevel(trimmed) {
				flushParagraph()
				blocks.append(.heading(heading.level, heading.text))
				index += 1
				continue
			}
			if isRule(trimmed) {
				flushParagraph()
				blocks.append(.rule)
				index += 1
				continue
			}
			if trimmed.contains("|"), index + 1 < lines.count, isTableSeparator(lines[index + 1]) {
				flushParagraph()
				let header = tableCells(trimmed)
				var rows: [[String]] = []
				index += 2
				while index < lines.count, lines[index].contains("|"), !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
					rows.append(tableCells(lines[index]))
					index += 1
				}
				blocks.append(.table(header: header, rows: rows))
				continue
			}
			if trimmed.hasPrefix(">") {
				flushParagraph()
				var quoted: [String] = []
				while index < lines.count, lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
					quoted.append(String(lines[index].trimmingCharacters(in: .whitespaces).dropFirst()).trimmingCharacters(in: .whitespaces))
					index += 1
				}
				blocks.append(.quote(quoted.joined(separator: "\n")))
				continue
			}
			if bulletText(line) != nil {
				flushParagraph()
				var items: [String] = []
				while index < lines.count, let item = bulletText(lines[index]) {
					items.append(item)
					index += 1
				}
				blocks.append(.bullets(items))
				continue
			}
			if orderedItem(line) != nil {
				flushParagraph()
				var items: [OrderedItem] = []
				while index < lines.count, let item = orderedItem(lines[index]) {
					items.append(item)
					index += 1
				}
				blocks.append(.ordered(items))
				continue
			}
			paragraph.append(line)
			index += 1
		}
		flushParagraph()
		return blocks
	}

	private static func headingLevel(_ line: String) -> (level: Int, text: String)? {
		let hashes = line.prefix { $0 == "#" }.count
		guard (1 ... 6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
		return (hashes, String(line.dropFirst(hashes + 1)).trimmingCharacters(in: .whitespaces))
	}

	private static func isRule(_ line: String) -> Bool {
		let compact = line.replacingOccurrences(of: " ", with: "")
		guard compact.count >= 3, let first = compact.first, "-*_".contains(first) else { return false }
		return compact.allSatisfy { $0 == first }
	}

	private static func isTableSeparator(_ line: String) -> Bool {
		let trimmed = line.trimmingCharacters(in: .whitespaces)
		guard trimmed.contains("-") else { return false }
		return trimmed.allSatisfy { "|:- ".contains($0) }
	}

	private static func tableCells(_ line: String) -> [String] {
		var trimmed = line.trimmingCharacters(in: .whitespaces)
		if trimmed.hasPrefix("|") { trimmed.removeFirst() }
		if trimmed.hasSuffix("|") { trimmed.removeLast() }
		return trimmed.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
	}

	private static func bulletText(_ line: String) -> String? {
		let trimmed = line.drop { $0 == " " }
		guard let marker = trimmed.first, "-*+".contains(marker), trimmed.dropFirst().first == " " else { return nil }
		return String(trimmed.dropFirst(2))
	}

	private static func orderedItem(_ line: String) -> OrderedItem? {
		let trimmed = line.drop { $0 == " " }
		let digits = trimmed.prefix { $0.isASCII && $0.isNumber }
		guard !digits.isEmpty, digits.count <= 9, let number = Int(digits) else { return nil }
		let rest = trimmed.dropFirst(digits.count)
		guard let marker = rest.first, marker == "." || marker == ")", rest.dropFirst().first == " " else { return nil }
		return OrderedItem(number: number, text: String(rest.dropFirst(2)))
	}
}
