import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VettaKit

/// The composer shared by New Session and the chat: a tall multi-line field
/// (Return adds a line, the keyboard's mic dictates), pictures from Photos,
/// files from Files, and one send / stop button.
struct ChatInputBar: View {
	@Binding var draft: PromptDraft
	var placeholder: String
	var disabled = false
	var busy = false
	var onStop: (() -> Void)?
	var onSend: (PromptDraft) -> Void

	@State private var photoItems: [PhotosPickerItem] = []
	@State private var pickingPhotos = false
	@State private var pickingFiles = false
	@State private var attachError: String?
	@FocusState private var focused: Bool

	private var canSend: Bool { draft.canSend && !disabled }

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			if !draft.attachments.isEmpty {
				AttachmentStrip(attachments: draft.attachments) { id in
					withAnimation(.snappy) { draft.remove(id) }
				}
			}
			TextField(placeholder, text: $draft.text, axis: .vertical)
				.font(.body)
				.lineLimit(3 ... 8)
				.focused($focused)
				.disabled(disabled)
				.accessibilityIdentifier("composer.field")
			HStack(spacing: 12) {
				Menu {
					Button { pickingPhotos = true } label: {
						Label(L10n.Chat.attachPhotos, systemImage: "photo.on.rectangle")
					}
					Button { pickingFiles = true } label: {
						Label(L10n.Chat.attachFiles, systemImage: "doc")
					}
					#if DEBUG
					// The Photos and Files pickers run out of process; UI tests attach through here.
					if ProcessInfo.processInfo.arguments.contains("-VettaUITestAttachments") {
						Button(action: addSamples) {
							Label(L10n.Chat.attach, systemImage: "ladybug")
						}
						.accessibilityIdentifier("composer.attach.sample")
					}
					#endif
				} label: {
					Image(systemName: "plus")
						.font(.system(size: 17, weight: .semibold))
						.frame(width: 34, height: 34)
				}
				.buttonStyle(.glass)
				.buttonBorderShape(.circle)
				.disabled(disabled)
				.accessibilityLabel(L10n.Chat.attach)
				.accessibilityIdentifier("composer.attach")
				if let attachError {
					Text(attachError)
						.font(.caption)
						.foregroundStyle(Theme.red)
						.lineLimit(2)
						.transition(.opacity)
				}
				Spacer(minLength: 0)
				sendButton
			}
		}
		.padding(.horizontal, 16)
		.padding(.top, 14)
		.padding(.bottom, 10)
		.glassEffect(.regular.interactive(), in: .rect(cornerRadius: 26))
		.contentShape(Rectangle())
		.onTapGesture { focused = true }
		.padding(.horizontal, 12)
		.padding(.bottom, 8)
		.photosPicker(isPresented: $pickingPhotos, selection: $photoItems, maxSelectionCount: PromptDraft.maxAttachments, matching: .images)
		.onChange(of: photoItems) { _, items in
			guard !items.isEmpty else { return }
			photoItems = []
			Task { await addPhotos(items) }
		}
		.fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
			if case let .success(urls) = result { addFiles(urls) }
		}
	}

	@ViewBuilder
	private var sendButton: some View {
		if busy, let onStop {
			Button(action: onStop) {
				Image(systemName: "stop.fill")
					.font(.system(size: 14, weight: .bold))
					.foregroundStyle(Theme.pillInk)
					.frame(width: 34, height: 34)
			}
			.buttonStyle(.glassProminent)
			.buttonBorderShape(.circle)
			.tint(Theme.pill)
			.accessibilityLabel(L10n.Chat.stop)
			.accessibilityIdentifier("composer.stop")
		} else {
			Button(action: submit) {
				Image(systemName: "arrow.up")
					.font(.system(size: 16, weight: .bold))
					.foregroundStyle(canSend ? Theme.pillInk : Theme.faint)
					.frame(width: 34, height: 34)
			}
			.buttonStyle(.glassProminent)
			.buttonBorderShape(.circle)
			.tint(canSend ? Theme.pill : Theme.card2)
			.disabled(!canSend)
			.accessibilityLabel(L10n.Chat.send)
			.accessibilityIdentifier("composer.send")
		}
	}

	private func submit() {
		guard canSend else { return }
		let sent = draft
		draft.clear()
		attachError = nil
		onSend(sent)
	}

	private func add(_ attachment: PromptAttachment) {
		do {
			try draft.add(attachment)
		} catch let error as PromptAttachmentError {
			withAnimation { attachError = describe(error) }
		} catch {}
	}

	private func describe(_ error: PromptAttachmentError) -> String {
		switch error {
		case let .tooLarge(name): L10n.Chat.attachTooLarge(name)
		case .tooMany: L10n.Chat.attachTooMany(PromptDraft.maxAttachments)
		}
	}

	private func addPhotos(_ items: [PhotosPickerItem]) async {
		attachError = nil
		for (index, item) in items.enumerated() {
			guard let data = try? await item.loadTransferable(type: Data.self),
			      let jpeg = ImageDownscaler.jpeg(from: data, maxBytes: PromptDraft.maxAttachmentBytes)
			else { continue }
			add(PromptAttachment(kind: .image, name: "photo-\(index + 1).jpg", mimeType: "image/jpeg", data: jpeg))
		}
	}

	#if DEBUG
	private func addSamples() {
		let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
			UIColor.systemGreen.setFill()
			context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
		}
		if let jpeg = image.jpegData(compressionQuality: 0.8) {
			add(PromptAttachment(kind: .image, name: "photo-sample.jpg", mimeType: "image/jpeg", data: jpeg))
		}
		add(PromptAttachment(kind: .file, name: "notes.txt", mimeType: "text/plain", data: Data("hello".utf8)))
	}
	#endif

	private func addFiles(_ urls: [URL]) {
		attachError = nil
		for url in urls {
			let scoped = url.startAccessingSecurityScopedResource()
			defer { if scoped { url.stopAccessingSecurityScopedResource() } }
			guard let data = try? Data(contentsOf: url) else { continue }
			let type = UTType(filenameExtension: url.pathExtension)
			if type?.conforms(to: .image) == true, let jpeg = ImageDownscaler.jpeg(from: data, maxBytes: PromptDraft.maxAttachmentBytes) {
				add(PromptAttachment(kind: .image, name: url.deletingPathExtension().lastPathComponent + ".jpg", mimeType: "image/jpeg", data: jpeg))
			} else {
				add(PromptAttachment(kind: .file, name: url.lastPathComponent, mimeType: type?.preferredMIMEType ?? "application/octet-stream", data: data))
			}
		}
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
		guard var image = UIImage(data: data) else { return nil }
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
