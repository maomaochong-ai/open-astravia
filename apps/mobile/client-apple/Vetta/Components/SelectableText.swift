import SwiftUI
import UIKit

/// Read-only text the user can long-press to select any part of, with the
/// system's handles and Copy menu; SwiftUI's `Text` on iOS only copies all of it.
/// Hugs its text, so a bubble around it stays as narrow as the words.
struct SelectableText: UIViewRepresentable {
	let text: NSAttributedString
	/// The handles and highlight; the bubble passes white since blue vanishes on it.
	var tint: UIColor = Theme.selectionUI
	@Environment(\.openURL) private var openURL

	func makeCoordinator() -> Coordinator { Coordinator() }

	func makeUIView(context: Context) -> UITextView {
		let view = UITextView(usingTextLayoutManager: true)
		view.isEditable = false
		view.isSelectable = true
		view.isScrollEnabled = false
		view.backgroundColor = .clear
		view.textContainerInset = .zero
		view.textContainer.lineFragmentPadding = 0
		// Links keep the colour the text gives them.
		view.linkTextAttributes = [:]
		view.delegate = context.coordinator
		view.textLayoutManager?.delegate = context.coordinator.chips
		view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
		return view
	}

	func updateUIView(_ view: UITextView, context: Context) {
		context.coordinator.openURL = openURL
		view.tintColor = tint
		if !view.attributedText.isEqual(to: text) { view.attributedText = text }
	}

	func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
		let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? .greatestFiniteMagnitude
		guard let layout = uiView.textLayoutManager else { return nil }
		uiView.textContainer.size = CGSize(width: width, height: .greatestFiniteMagnitude)
		layout.ensureLayout(for: layout.documentRange)
		let used = layout.usageBoundsForTextContainer
		return CGSize(width: ceil(min(used.width, width)), height: ceil(used.height))
	}

	final class Coordinator: NSObject, UITextViewDelegate {
		var openURL: OpenURLAction?
		/// Held here: the layout manager keeps its delegate weakly.
		let chips = ChipLayoutDelegate()

		/// A tap on a link goes where SwiftUI's links go, so a desktop file opens in the app.
		func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
			guard case let .link(url) = textItem.content, let openURL else { return defaultAction }
			return UIAction { _ in openURL(url) }
		}
	}
}

/// Lays text out in fragments that draw chips. Nonisolated, like the fragments,
/// since TextKit may lay out and draw off the main actor.
nonisolated final class ChipLayoutDelegate: NSObject, NSTextLayoutManagerDelegate {
	func textLayoutManager(
		_ textLayoutManager: NSTextLayoutManager,
		textLayoutFragmentFor location: any NSTextLocation,
		in textElement: NSTextElement
	) -> NSTextLayoutFragment {
		ChipLayoutFragment(textElement: textElement, range: textElement.elementRange)
	}
}

nonisolated extension NSAttributedString.Key {
	/// Marks an inline-code span or a link, drawn as a chip behind its text.
	static let vettaChip = NSAttributedString.Key("vetta.chip")
}

/// The value behind `.vettaChip`; one object per span, so touching spans stay apart.
nonisolated final class ChipMark: NSObject, Sendable {
	let kind: InlineChip.Kind

	init(kind: InlineChip.Kind) {
		self.kind = kind
	}
}

/// Draws the chips `InlineChipRenderer` draws for SwiftUI text: a soft grey
/// tile behind inline code and a tinted, outlined pill behind a link, one per
/// line a span covers, before the text itself.
private nonisolated final class ChipLayoutFragment: NSTextLayoutFragment {
	override var renderingSurfaceBounds: CGRect {
		super.renderingSurfaceBounds.insetBy(dx: -4, dy: -4)
	}

	override func draw(at point: CGPoint, in context: CGContext) {
		if let string = (textElement as? NSTextParagraph)?.attributedString {
			for line in textLineFragments {
				drawChips(in: line, of: string, at: point, context: context)
			}
		}
		super.draw(at: point, in: context)
	}

	private func drawChips(in line: NSTextLineFragment, of string: NSAttributedString, at point: CGPoint, context: CGContext) {
		let lineRange = line.characterRange
		guard lineRange.length > 0, NSMaxRange(lineRange) <= string.length else { return }
		// The line's baseline sits its tallest font's ascent below its top; line spacing goes below.
		var ascent: CGFloat = 0
		string.enumerateAttribute(.font, in: lineRange) { value, _, _ in
			if let font = value as? UIFont { ascent = max(ascent, font.ascender) }
		}
		let bounds = line.typographicBounds
		let baseline = point.y + bounds.minY + ascent
		string.enumerateAttribute(.vettaChip, in: lineRange) { value, range, _ in
			guard let chip = value as? ChipMark else { return }
			// The chip is as tall as the text around it, not the code's smaller font.
			let font = string.attribute(.font, at: range.location, effectiveRange: nil) as? UIFont ?? .systemFont(ofSize: 16)
			let start = line.locationForCharacter(at: range.location).x
			let end = line.locationForCharacter(at: NSMaxRange(range)).x
			var rect = CGRect(
				x: point.x + bounds.minX + start,
				y: baseline - font.ascender,
				width: end - start,
				height: font.ascender - font.descender
			)
			let link = chip.kind == .link
			rect = rect.insetBy(dx: -1.5, dy: link ? -2.5 : -1.5)
			let path = UIBezierPath(roundedRect: rect, cornerRadius: link ? 7 : 6).cgPath
			context.saveGState()
			context.addPath(path)
			context.setFillColor((link ? Theme.Chip.link.withAlphaComponent(0.1) : Theme.Chip.codeFill).cgColor)
			context.fillPath()
			context.addPath(path)
			context.setStrokeColor((link ? Theme.Chip.link.withAlphaComponent(0.32) : Theme.Chip.codeStroke).cgColor)
			context.setLineWidth(link ? 1 : 0.75)
			context.strokePath()
			context.restoreGState()
		}
	}
}
