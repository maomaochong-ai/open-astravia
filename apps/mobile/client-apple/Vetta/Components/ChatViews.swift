import SwiftUI
import VettaKit

struct UserBubble: View {
	var text: String
	var attachments: [TranscriptAttachment] = []

	var body: some View {
		// The skills the message starts with show as chips; the words go in the bubble.
		let (skills, words) = SkillTokens.split(text)
		VStack(alignment: .trailing, spacing: 6) {
			if !skills.isEmpty {
				HStack(spacing: 6) {
					ForEach(skills) { SkillChip(skill: $0) }
				}
				.frame(maxWidth: .infinity, alignment: .trailing)
				.accessibilityIdentifier("bubble.skills")
			}
			if !attachments.isEmpty {
				HStack(spacing: 6) {
					ForEach(Array(attachments.enumerated()), id: \.offset) { _, attachment in
						Label(attachment.name, systemImage: attachment.kind == .image ? "photo" : "doc")
							.font(.caption)
							.lineLimit(1)
							.padding(.horizontal, 10)
							.padding(.vertical, 6)
							.background(Theme.card2, in: .capsule)
					}
				}
				.frame(maxWidth: .infinity, alignment: .trailing)
				.accessibilityIdentifier("bubble.attachments")
			}
			if !words.isEmpty { bubble(words) }
		}
		.padding(.bottom, 16)
	}

	private func bubble(_ text: String) -> some View {
		HStack {
			Spacer(minLength: 48)
			SelectableText(text: Self.attributed(text), tint: .white)
				.padding(.horizontal, 13)
				.padding(.vertical, 8)
				.padding(.bottom, MessageBubbleShape.tail)
				.background(MessageBubbleShape().fill(Theme.userBubble))
		}
	}

	private static func attributed(_ text: String) -> NSAttributedString {
		let paragraph = NSMutableParagraphStyle()
		paragraph.lineSpacing = 2
		return NSAttributedString(string: text, attributes: [
			.font: UIFont.systemFont(ofSize: 16),
			.foregroundColor: UIColor.white,
			.paragraphStyle: paragraph,
		])
	}
}

/// The iMessage bubble: a rounded body with a tail hooking down just inside the trailing edge.
/// The tail hangs `tail` points below the body, which the content pads for.
/// Nonisolated because SwiftUI lays shapes out off the main actor. 
nonisolated struct MessageBubbleShape: Shape {
	static let tail: CGFloat = 7.5

	func path(in rect: CGRect) -> Path {
		let w = rect.width
		let h = rect.height - Self.tail
		let r = min(18, h / 2, w / 2)
		var p = Path()
		p.move(to: CGPoint(x: r, y: 0))
		p.addLine(to: CGPoint(x: w - r, y: 0))
		p.addArc(tangent1End: CGPoint(x: w, y: 0), tangent2End: CGPoint(x: w, y: r), radius: r)
		p.addLine(to: CGPoint(x: w, y: h - r))
		p.addArc(center: CGPoint(x: w - r, y: h - r), radius: r, startAngle: .degrees(0), endAngle: .degrees(15), clockwise: false)
		// Pinch in under the corner, drop to the tip, then sweep back into the bottom edge.
		p.addCurve(to: CGPoint(x: w - 9, y: h - 1.5), control1: CGPoint(x: w - 1, y: h - 8), control2: CGPoint(x: w - 6, y: h - 3))
		p.addCurve(to: CGPoint(x: w - 8, y: h + Self.tail), control1: CGPoint(x: w - 11, y: h), control2: CGPoint(x: w - 10, y: h + 5))
		p.addCurve(to: CGPoint(x: w - 26, y: h), control1: CGPoint(x: w - 12, y: h + 6.5), control2: CGPoint(x: w - 18, y: h + 0.5))
		p.addLine(to: CGPoint(x: r, y: h))
		p.addArc(tangent1End: CGPoint(x: 0, y: h), tangent2End: CGPoint(x: 0, y: h - r), radius: r)
		p.addLine(to: CGPoint(x: 0, y: r))
		p.addArc(tangent1End: CGPoint(x: 0, y: 0), tangent2End: CGPoint(x: r, y: 0), radius: r)
		p.closeSubpath()
		return p
	}
}

struct MarkerRow: View {
	var text: String

	var body: some View {
		Text(text)
			.font(.system(size: 11))
			.foregroundStyle(Theme.faint)
			.frame(maxWidth: .infinity)
			.padding(.bottom, 16)
	}
}

func toolSymbol(_ toolName: String) -> String {
	let name = toolName.lowercased()
	if name.contains("search") || name.contains("fetch") || name.contains("web") { return "magnifyingglass" }
	if name.contains("bash") || name.contains("shell") || name.contains("exec") || name.contains("terminal") { return "apple.terminal" }
	if name.contains("aggregate") || name.contains("data") || name.contains("compute") { return "gearshape.2" }
	return "wrench.and.screwdriver"
}

/// First scalar argument, as the Expo card showed it next to the tool name.
func summarizeArgs(_ args: String?) -> String {
	guard let args, !args.isEmpty else { return "" }
	if let value = try? JSONValue.parse(args), let fields = value.objectValue {
		let ordered = orderedKeys(args).compactMap { fields[$0] }
		for field in ordered {
			if let text = field.stringValue { return String(text.prefix(60)) }
			if let number = field.numberValue { return String(JSONValue.number(number).serialized().prefix(60)) }
		}
	}
	return String(args.prefix(60))
}

/// Top-level keys in source order (JSON objects lose order once parsed).
private func orderedKeys(_ json: String) -> [String] {
	guard let data = json.data(using: .utf8),
	      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
	else { return [] }
	return object.keys.sorted { lhs, rhs in
		(json.range(of: "\"\(lhs)\"")?.lowerBound ?? json.endIndex) < (json.range(of: "\"\(rhs)\"")?.lowerBound ?? json.endIndex)
	}
}

struct ToolCardView: View {
	var tool: ToolCard
	@State private var open = false

	private var badge: (label: String, tone: PillTone) {
		switch tool.status {
		case .done: (tool.label ?? L10n.Chat.toolDone, .green)
		case .failed: (L10n.Chat.toolFailed, .orange)
		case .generating: (L10n.Chat.toolGenerating, .neutral)
		case .running: (tool.label ?? L10n.Chat.toolRunning, .neutral)
		}
	}

	var body: some View {
		let summary = summarizeArgs(tool.args)
		let detail = tool.result ?? tool.args
		VStack(alignment: .leading, spacing: 0) {
			Button {
				withAnimation(.snappy) { open.toggle() }
			} label: {
				HStack(spacing: 10) {
					Image(systemName: toolSymbol(tool.toolName))
						.font(.system(size: 14, weight: .medium))
						.foregroundStyle(Theme.ink2)
						.frame(width: 18)
					Text("\(Text(tool.toolName).foregroundStyle(Theme.ink))\(Text(summary.isEmpty ? "" : ": \(summary)").foregroundStyle(Theme.ink2))")
						.font(.mono(13))
						.lineLimit(1)
						.frame(maxWidth: .infinity, alignment: .leading)
					if tool.status == .running || tool.status == .generating {
						ProgressView().controlSize(.mini)
					}
					Pill(text: badge.label, tone: badge.tone)
					Image(systemName: open ? "chevron.up" : "chevron.down")
						.font(.system(size: 11, weight: .semibold))
						.foregroundStyle(Theme.dim)
				}
				.padding(.horizontal, 14)
				.padding(.vertical, 12)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			if open, let detail, !detail.isEmpty {
				Rectangle().fill(Theme.line).frame(height: 1)
				VStack(alignment: .leading, spacing: 8) {
					Text(detail)
						.font(.mono(12))
						.lineSpacing(4)
						.foregroundStyle(Theme.ink2)
						.lineLimit(30)
						.textSelection(.enabled)
					if let duration = tool.durationMs {
						Text("\(Int(duration.rounded())) ms").font(.mono(11)).foregroundStyle(Theme.faint)
					}
				}
				.padding(.horizontal, 14)
				.padding(.vertical, 12)
				.frame(maxWidth: .infinity, alignment: .leading)
			}
		}
		.glassEffect(.regular, in: .rect(cornerRadius: 16))
		.padding(.bottom, 8)
	}
}

struct ThinkingBlock: View {
	var text: String
	var live: Bool
	@State private var open = false

	var body: some View {
		if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			VStack(alignment: .leading, spacing: 4) {
				Button {
					withAnimation(.snappy) { open.toggle() }
				} label: {
					HStack(spacing: 6) {
						Image(systemName: "brain").font(.system(size: 12)).foregroundStyle(Theme.dim)
						Text(live ? L10n.Chat.thinkingLive : L10n.Chat.thinking)
							.font(.system(size: 12))
							.foregroundStyle(Theme.dim)
						Image(systemName: open ? "chevron.up" : "chevron.down")
							.font(.system(size: 10, weight: .semibold))
							.foregroundStyle(Theme.faint)
					}
					.padding(.vertical, 4)
				}
				.buttonStyle(.plain)
				if open || live {
					Text(text)
						.font(.system(size: 13))
						.lineSpacing(4)
						.foregroundStyle(Theme.faint)
						.lineLimit(open ? nil : 4)
				}
			}
			.padding(.bottom, 8)
		}
	}
}

/// The top of an agent's turn: avatar, name, when it started and, while it
/// runs, what it is doing. The turn's pieces follow as rows of their own (see `ChatLine`).
struct TurnHeader: View {
	var id: String
	var startedAt: Double?
	var streaming: Bool
	var empty: Bool
	/// What the live turn is doing that its content does not show, e.g. a retry.
	var note: String?

	var body: some View {
		HStack(spacing: 8) {
			BotAvatar(size: 22)
			Text("Vetta").font(.subheadline.weight(.semibold))
			if let startedAt {
				Text(TimeFormat.relative(startedAt)).font(.caption).foregroundStyle(.secondary)
			}
			if streaming {
				Text(note ?? (empty ? L10n.Chat.waitingModel : L10n.Chat.working))
					.font(.caption)
					.foregroundStyle(.secondary)
					.shimmer()
					.transition(.opacity)
					.accessibilityIdentifier("turn.status")
			}
		}
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("turn.\(id)")
	}
}

/// One segment of a turn: a folded work group, the answer as Markdown, or a failure.
struct TurnPieceView: View {
	var segment: TurnSegment
	var live: Bool
	var activity: WorkStep?

	var body: some View {
		switch segment {
		case let .work(_, steps):
			WorkGroupView(steps: steps, live: live, activity: activity)
		case let .text(_, text):
			StreamingMarkdown(text: text, live: live)
		case let .error(_, message, count):
			HStack(alignment: .firstTextBaseline, spacing: 6) {
				Label(message, systemImage: "exclamationmark.triangle.fill")
				if count > 1 {
					Text("×\(count)")
						.font(.caption.weight(.semibold).monospacedDigit())
						.padding(.horizontal, 6)
						.padding(.vertical, 1)
						.background(Theme.red.opacity(0.15), in: .capsule)
				}
			}
			.font(.subheadline)
			.foregroundStyle(Theme.red)
			.padding(12)
			.frame(maxWidth: .infinity, alignment: .leading)
			.background(Theme.red.opacity(0.08), in: .rect(cornerRadius: 14))
			.accessibilityElement(children: .combine)
			.accessibilityIdentifier("turn.error")
		}
	}
}

/// Copies a finished turn's closing answer.
struct TurnCopyButton: View {
	var conclusion: String
	@State private var copied = false

	var body: some View {
		Button {
			UIPasteboard.general.string = conclusion
			withAnimation { copied = true }
			Task {
				try? await Task.sleep(for: .seconds(1.5))
				withAnimation { copied = false }
			}
		} label: {
			Label(copied ? L10n.Chat.copied : L10n.Chat.copy, systemImage: copied ? "checkmark" : "doc.on.doc")
				.font(.caption)
				.foregroundStyle(.secondary)
				.contentTransition(.symbolEffect(.replace))
		}
		.buttonStyle(.plain)
		.accessibilityIdentifier("turn.copy")
	}
}

/// Consecutive thinking and tool calls folded into one row: while live it names
/// the current step, afterwards it counts them; expanding lists every step.
struct WorkGroupView: View {
	var steps: [WorkStep]
	var live: Bool
	var activity: WorkStep?
	@State private var open = false

	private var title: String {
		guard live else { return L10n.Chat.stepsDone(steps.count) }
		switch activity {
		case let .thinking(_, text)?:
			let tail = text.split(whereSeparator: \.isNewline).last.map(String.init) ?? text
			return L10n.Chat.thinkingActivity(String(tail.suffix(40)))
		case let .tool(card)?:
			let summary = summarizeArgs(card.args)
			return card.label ?? (summary.isEmpty ? card.toolName : "\(card.toolName) · \(summary)")
		case nil:
			return L10n.Chat.working
		}
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				withAnimation(.snappy) { open.toggle() }
			} label: {
				HStack(spacing: 8) {
					if live {
						ProgressView().controlSize(.mini)
					} else {
						Image(systemName: steps.contains { if case let .tool(card) = $0 { card.status == .failed } else { false } } ? "exclamationmark.circle" : "checkmark.circle")
							.foregroundStyle(.secondary)
					}
					Text(title)
						.lineLimit(1)
						.shimmer(live)
						.frame(maxWidth: .infinity, alignment: .leading)
					Image(systemName: "chevron.right")
						.font(.caption.weight(.semibold))
						.rotationEffect(.degrees(open ? 90 : 0))
						.foregroundStyle(.tertiary)
				}
				.font(.subheadline)
				.foregroundStyle(.secondary)
				.padding(.horizontal, 12)
				.padding(.vertical, 10)
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("turn.work")
			if open {
				VStack(alignment: .leading, spacing: 0) {
					ForEach(steps) { step in
						switch step {
						case let .thinking(_, text):
							ThinkingBlock(text: text, live: live && step.id == activity?.id)
						case let .tool(card):
							ToolCardView(tool: card)
						}
					}
				}
				.padding(.horizontal, 8)
				.padding(.bottom, 4)
				.transition(.opacity)
			}
		}
		.background(Theme.card2.opacity(0.6), in: .rect(cornerRadius: 14))
	}
}

/// A reply's text as it streams in: shown at an even pace, each new character
/// fading in (see `StreamReveal`), while the view keeps drawing frames only
/// until the text has caught up and settled. Text that was already there when
/// the chat opened is shown at once.
struct StreamingMarkdown: View {
	var text: String
	var live: Bool
	@State private var clock = RevealClock()
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	var body: some View {
		let target = text.count
		if reduceMotion || !clock.started && !live {
			MarkdownView(text: text)
		} else {
			TimelineView(.animation(minimumInterval: 1.0 / 60, paused: clock.idle && !clock.behind(target))) { context in
				let reveal = clock.advance(to: context.date.timeIntervalSinceReferenceDate, target: target)
				// Once the reply is over and every character has faded in, it becomes selectable.
				let settled = !live && !reveal.animating(toward: target)
				MarkdownView(
					text: reveal.shown == target ? text : String(text.prefix(reveal.shown)),
					// A fade lasts `fade` seconds and the head moves at most `backlog / catchUp` per second.
					fade: settled ? nil : FadeTail(span: 160) { reveal.opacity(at: reveal.shown - 1 - $0) }
				)
			}
		}
	}
}

/// Holds a `StreamReveal` across frames. Advancing is not observed, so frames
/// do not invalidate the view; only `idle` is, flipped after a frame so the
/// timeline pauses once there is nothing left to animate.
@Observable
final class RevealClock {
	@ObservationIgnored private(set) var started = false
	@ObservationIgnored private var reveal: StreamReveal?
	var idle = false

	func behind(_ target: Int) -> Bool {
		reveal.map { $0.animating(toward: target) } ?? true
	}

	func advance(to time: Double, target: Int) -> StreamReveal {
		// Only the last few characters of text already on screen fade in, not the whole reply again.
		var next = reveal ?? StreamReveal(shown: max(0, target - 24), at: time)
		started = true
		next.advance(to: time, target: target)
		reveal = next
		let settled = !next.animating(toward: target)
		if settled != idle { Task { @MainActor in self.idle = settled } }
		return next
	}
}

/// A soft band of light sweeping across a status line while the agent works.
struct Shimmer: ViewModifier {
	var active: Bool
	@State private var phase: CGFloat = -1
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	func body(content: Content) -> some View {
		if active, !reduceMotion {
			content
				.mask {
					GeometryReader { geometry in
						LinearGradient(
							stops: [
								.init(color: .black.opacity(0.45), location: 0),
								.init(color: .black, location: 0.5),
								.init(color: .black.opacity(0.45), location: 1),
							],
							startPoint: .leading,
							endPoint: .trailing
						)
						.frame(width: geometry.size.width * 3)
						.offset(x: phase * geometry.size.width - geometry.size.width)
					}
				}
				.onAppear {
					withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { phase = 1 }
				}
		} else {
			content
		}
	}
}

extension View {
	func shimmer(_ active: Bool = true) -> some View { modifier(Shimmer(active: active)) }
}
