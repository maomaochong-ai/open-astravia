import SwiftUI
import VettaKit

/// The composer shared by New Session and the chat, laid out like Telegram:
/// a round attach button, then the message field that grows with its text
/// (Return adds a line). Send appears inside the field once there is something
/// to send. Holding the empty field dictates; letting go puts the words in the
/// field without sending them.
struct ChatInputBar: View {
	@Binding var draft: PromptDraft
	var placeholder: String
	var disabled = false
	var busy = false
	var onStop: (() -> Void)?
	var onSend: (PromptDraft) -> Void

	@State private var attaching = false
	@State private var dictation = SpeechDictation()
	@State private var press = HoldToTalk()
	@State private var cancelArmed = false
	@State private var holdTimer: Task<Void, Never>?
	@State private var notice: String?
	@FocusState private var focused: Bool

	/// The attach button and a one-line field share this height.
	private static let barHeight: CGFloat = 44

	private var canSend: Bool { draft.canSend && !disabled }
	private var holdToTalk: Bool { draft.text.isEmpty && !disabled }

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			if !draft.attachments.isEmpty {
				AttachmentStrip(attachments: draft.attachments) { id in
					withAnimation(.snappy) { draft.remove(id) }
				}
				.padding(.horizontal, 16)
			}
			if let notice {
				Text(notice)
					.font(.caption)
					.foregroundStyle(Theme.red)
					.padding(.horizontal, 20)
					.transition(.opacity)
			}
			HStack(alignment: .bottom, spacing: 8) {
				// Plain glass circle at the field's height: .buttonStyle(.glass) pads it larger.
				Button { attaching = true } label: {
					Image(systemName: "command")
						.font(.system(size: 19, weight: .medium))
						.foregroundStyle(disabled ? .tertiary : .primary)
						.frame(width: Self.barHeight, height: Self.barHeight)
						.glassEffect(.regular.interactive(), in: .circle)
				}
				.buttonStyle(.plain)
				.disabled(disabled)
				.accessibilityLabel(L10n.Chat.attach)
				.accessibilityIdentifier("composer.attach")

				field
			}
			.padding(.horizontal, 12)
			// The glow takes over the bottom while listening; the bar fades out under it.
			.opacity(dictation.listening ? 0.15 : 1)
		}
		// Sits low over the home indicator; with the keyboard up it keeps a small gap above it.
		.padding(.bottom, focused ? 8 : -10)
		.animation(.snappy, value: focused)
		.overlay(alignment: .bottom) {
			if dictation.listening {
				DictationGlow(transcript: dictation.transcript, level: dictation.level, cancelArmed: cancelArmed)
					.allowsHitTesting(false)
					.transition(.opacity)
			}
		}
		.animation(.easeInOut(duration: 0.2), value: dictation.listening)
		.sheet(isPresented: $attaching) {
			AttachmentSheet(draft: $draft)
		}
	}

	private var field: some View {
		HStack(alignment: .bottom, spacing: 6) {
			TextField(placeholder, text: $draft.text, axis: .vertical)
				.font(.body)
				.lineLimit(1 ... 6)
				.focused($focused)
				.disabled(disabled)
				.padding(.leading, 16)
				.padding(.vertical, 11)
				.accessibilityIdentifier("composer.field")
				.overlay {
					// On an empty field a hold dictates; a tap still starts typing.
					if holdToTalk {
						Color.clear
							.contentShape(Rectangle())
							.gesture(holdGesture)
							.accessibilityHidden(true)
					}
				}
			trailingButton
		}
		.padding(.trailing, 5)
		.frame(minHeight: Self.barHeight)
		.glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("composer.box")
	}

	@ViewBuilder
	private var trailingButton: some View {
		if busy, let onStop {
			Button(action: onStop) {
				Image(systemName: "stop.fill")
					.font(.system(size: 13, weight: .bold))
					.foregroundStyle(Theme.pillInk)
					.frame(width: 34, height: 34)
					.background(Theme.pill, in: .circle)
			}
			.buttonStyle(.plain)
			.padding(.bottom, 5)
			.accessibilityLabel(L10n.Chat.stop)
			.accessibilityIdentifier("composer.stop")
		} else if canSend {
			Button(action: submit) {
				Image(systemName: "arrow.up")
					.font(.system(size: 16, weight: .bold))
					.foregroundStyle(Theme.pillInk)
					.frame(width: 34, height: 34)
					.background(Theme.pill, in: .circle)
			}
			.buttonStyle(.plain)
			.padding(.bottom, 5)
			.transition(.scale.combined(with: .opacity))
			.accessibilityLabel(L10n.Chat.send)
			.accessibilityIdentifier("composer.send")
		}
	}

	private var holdGesture: some Gesture {
		DragGesture(minimumDistance: 0, coordinateSpace: .global)
			.onChanged { value in
				let now = Date.timeIntervalSinceReferenceDate
				if press.phase == .idle {
					_ = press.began(at: now)
					// Holding still sends no drag events, so a timer checks once the hold is long enough.
					holdTimer = Task {
						try? await Task.sleep(for: .seconds(HoldToTalk.holdDelay))
						guard !Task.isCancelled else { return }
						handle(press.moved(dx: 0, dy: 0, at: Date.timeIntervalSinceReferenceDate))
					}
					return
				}
				handle(press.moved(dx: value.translation.width, dy: value.translation.height, at: now))
			}
			.onEnded { _ in
				holdTimer?.cancel()
				handle(press.ended(at: Date.timeIntervalSinceReferenceDate))
			}
	}

	private func handle(_ action: HoldToTalk.Action) {
		switch action {
		case .none:
			return
		case .focus:
			focused = true
		case .startListening:
			focused = false
			cancelArmed = false
			withAnimation { notice = nil }
			UIImpactFeedbackGenerator(style: .medium).impactOccurred()
			Task {
				await dictation.start()
				switch dictation.failure {
				case .denied?: withAnimation { notice = L10n.Chat.dictationDenied }
				case .unavailable?: withAnimation { notice = L10n.Chat.dictationUnavailable }
				case nil: break
				}
			}
		case let .cancelArmed(armed):
			withAnimation(.snappy) { cancelArmed = armed }
			UISelectionFeedbackGenerator().selectionChanged()
		case let .finish(insert):
			Task {
				if insert {
					let heard = await dictation.stop()
					withAnimation(.snappy) { draft.insertDictation(heard) }
				} else {
					dictation.cancel()
				}
				cancelArmed = false
			}
		}
	}

	private func submit() {
		guard canSend else { return }
		let sent = draft
		draft.clear()
		notice = nil
		onSend(sent)
	}
}

/// What the user is saying, shown over the bottom of the screen on a blue glow
/// that swells with their voice; grey while letting go would cancel.
private struct DictationGlow: View {
	var transcript: String
	var level: Double
	var cancelArmed: Bool

	var body: some View {
		let tint = cancelArmed ? Color.gray : Color(red: 0.08, green: 0.47, blue: 1)
		ZStack(alignment: .bottom) {
			EllipticalGradient(
				colors: [tint, tint.opacity(0.85), tint.opacity(0.45), tint.opacity(0)],
				center: .bottom,
				startRadiusFraction: 0,
				endRadiusFraction: 0.85 + 0.12 * level
			)
			.scaleEffect(x: 1.4, y: 1, anchor: .bottom)
			.animation(.easeOut(duration: 0.15), value: level)
			VStack(spacing: 14) {
				Text(cancelArmed ? L10n.Chat.dictationCancel : L10n.Chat.dictationHint)
					.font(.subheadline.weight(.medium))
					.foregroundStyle(.white.opacity(0.85))
				Text(transcript.isEmpty ? L10n.Chat.dictationListening : transcript)
					.font(.title3.weight(.semibold))
					.foregroundStyle(.white)
					.multilineTextAlignment(.center)
					.lineLimit(4)
					.truncationMode(.head)
					.contentTransition(.opacity)
					.accessibilityIdentifier("dictation.transcript")
			}
			.padding(.horizontal, 28)
			.padding(.bottom, 120)
		}
		.frame(maxWidth: .infinity)
		.frame(height: 380)
		.padding(.bottom, -48)
		.accessibilityElement(children: .contain)
		.accessibilityIdentifier("dictation.glow")
	}
}

/// Thumbnails for pictures and name chips for files, each with a remove button.
private struct AttachmentStrip: View {
	var attachments: [PromptAttachment]
	var onRemove: (String) -> Void

	var body: some View {
		ScrollView(.horizontal) {
			HStack(spacing: 8) {
				ForEach(attachments) { attachment in
					ZStack(alignment: .topTrailing) {
						preview(attachment)
						Button { onRemove(attachment.id) } label: {
							Image(systemName: "xmark.circle.fill")
								.font(.system(size: 18))
								.symbolRenderingMode(.palette)
								.foregroundStyle(.white, .black.opacity(0.6))
						}
						.buttonStyle(.plain)
						.offset(x: 6, y: -6)
						.accessibilityLabel(L10n.Chat.removeAttachment(attachment.name))
					}
					.accessibilityElement(children: .contain)
					.accessibilityIdentifier("composer.attachment")
				}
			}
			.padding(.top, 6)
			.padding(.trailing, 6)
		}
		.scrollIndicators(.hidden)
	}

	@ViewBuilder
	private func preview(_ attachment: PromptAttachment) -> some View {
		if attachment.kind == .image, let image = UIImage(data: attachment.data) {
			Image(uiImage: image)
				.resizable()
				.scaledToFill()
				.frame(width: 56, height: 56)
				.clipShape(.rect(cornerRadius: 12))
		} else {
			HStack(spacing: 6) {
				Image(systemName: "doc.fill").foregroundStyle(.secondary)
				Text(attachment.name).font(.caption).lineLimit(1)
			}
			.padding(.horizontal, 10)
			.frame(height: 56)
			.frame(maxWidth: 160)
			.background(Theme.card2, in: .rect(cornerRadius: 12))
		}
	}
}

enum ImageDownscaler {
	/// Re-encodes a picture as JPEG, shrinking it until it fits `maxBytes`.
	static func jpeg(from data: Data, maxBytes: Int) -> Data? {
		guard let image = UIImage(data: data) else { return nil }
		return jpeg(from: image, maxBytes: maxBytes)
	}

	static func jpeg(from source: UIImage, maxBytes: Int) -> Data? {
		var image = source
		var longest: CGFloat = 2048
		for _ in 0 ..< 6 {
			image = resized(image, longest: longest)
			for quality in [0.8, 0.6, 0.45] {
				if let encoded = image.jpegData(compressionQuality: quality), encoded.count <= maxBytes { return encoded }
			}
			longest *= 0.7
		}
		return nil
	}

	private static func resized(_ image: UIImage, longest: CGFloat) -> UIImage {
		let size = image.size
		let scale = min(1, longest / max(size.width, size.height))
		guard scale < 1 else { return image }
		let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
		let format = UIGraphicsImageRendererFormat.default()
		format.scale = 1
		return UIGraphicsImageRenderer(size: target, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
	}
}
