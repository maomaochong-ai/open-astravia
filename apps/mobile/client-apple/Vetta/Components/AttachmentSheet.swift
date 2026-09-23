import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VettaKit

private enum AttachTab: CaseIterable, Hashable {
	case photos, files, camera

	var title: String {
		switch self {
		case .photos: L10n.Chat.attachPhotos
		case .files: L10n.Chat.attachFiles
		case .camera: L10n.Chat.attachCamera
		}
	}

	var symbol: String {
		switch self {
		case .photos: "photo.on.rectangle"
		case .files: "doc.fill"
		case .camera: "camera.fill"
		}
	}
}

/// The attach button's half sheet, like Telegram's: the photo library inline,
/// Files, or the camera, switched by a glass tab bar at the bottom.
struct AttachmentSheet: View {
	@Binding var draft: PromptDraft
	@Environment(\.dismiss) private var dismiss
	@State private var tab = AttachTab.photos
	@State private var photoItems: [PhotosPickerItem] = []
	@State private var pickingFiles = false
	@State private var shooting = false
	@State private var adding = false
	@State private var notice: String?

	private var room: Int { max(0, PromptDraft.maxAttachments - draft.attachments.count) }

	var body: some View {
		VStack(spacing: 0) {
			header
			if let notice {
				Text(notice)
					.font(.caption)
					.foregroundStyle(Theme.red)
					.padding(.horizontal, 20)
					.padding(.bottom, 6)
			}
			content
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.safeAreaInset(edge: .bottom, spacing: 0) { tabBar }
		.presentationDetents([.medium, .large])
		.presentationDragIndicator(.visible)
		.fileImporter(isPresented: $pickingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
			if case let .success(urls) = result { addFiles(urls) }
		}
		.fullScreenCover(isPresented: $shooting) {
			CameraPicker { image in
				shooting = false
				if let image { addPhoto(image) }
			}
			.ignoresSafeArea()
		}
	}

	private var header: some View {
		HStack {
			Button { dismiss() } label: {
				Image(systemName: "xmark")
					.font(.system(size: 15, weight: .semibold))
					.frame(width: 36, height: 36)
			}
			.buttonStyle(.glass)
			.buttonBorderShape(.circle)
			.accessibilityLabel(L10n.Common.close)
			.accessibilityIdentifier("attach.close")
			Spacer()
			Text(tab.title).font(.headline)
			Spacer()
			ZStack {
				#if DEBUG
				// The Photos, Files and camera pickers run out of process; UI tests attach through here.
				if ProcessInfo.processInfo.arguments.contains("-VettaUITestAttachments"), tab == .files {
					Button(action: addSamples) {
						Image(systemName: "ladybug").frame(width: 36, height: 36)
					}
					.buttonStyle(.glass)
					.buttonBorderShape(.circle)
					.accessibilityIdentifier("composer.attach.sample")
				}
				#endif
				if tab == .photos, !photoItems.isEmpty {
					Button(L10n.Chat.attachAdd(photoItems.count)) { Task { await addPhotos() } }
						.buttonStyle(.glassProminent)
						.tint(Theme.green)
						.disabled(adding)
						.accessibilityIdentifier("attach.add")
				}
			}
			.frame(minWidth: 36)
		}
		.padding(.horizontal, 16)
		.padding(.top, 16)
		.padding(.bottom, 8)
	}

	@ViewBuilder
	private var content: some View {
		switch tab {
		case .photos:
			PhotosPicker(
				selection: $photoItems,
				maxSelectionCount: max(1, room),
				selectionBehavior: .ordered,
				matching: .images,
				photoLibrary: .shared()
			) {
				EmptyView()
			}
			.photosPickerStyle(.inline)
			.photosPickerDisabledCapabilities([.selectionActions])
			.photosPickerAccessoryVisibility(.hidden, edges: .all)
			.accessibilityIdentifier("attach.photos")
		case .files:
			placeholder(symbol: "doc.fill", text: L10n.Chat.attachFilesHint, action: L10n.Chat.attachBrowse, identifier: "attach.browse") {
				pickingFiles = true
			}
		case .camera:
			if UIImagePickerController.isSourceTypeAvailable(.camera) {
				placeholder(symbol: "camera.fill", text: nil, action: L10n.Chat.attachCamera, identifier: "attach.shoot") {
					shooting = true
				}
			} else {
				ContentUnavailableView(L10n.Chat.cameraUnavailable, systemImage: "camera.badge.ellipsis")
					.accessibilityIdentifier("attach.noCamera")
			}
		}
	}

	private func placeholder(symbol: String, text: String?, action: String, identifier: String, perform: @escaping () -> Void) -> some View {
		VStack(spacing: 14) {
			Image(systemName: symbol)
				.font(.system(size: 40))
				.foregroundStyle(.secondary)
			if let text {
				Text(text)
					.font(.subheadline)
					.foregroundStyle(.secondary)
					.multilineTextAlignment(.center)
			}
			Button(action, action: perform)
				.buttonStyle(.glassProminent)
				.tint(Theme.green)
				.accessibilityIdentifier(identifier)
		}
		.padding(.horizontal, 32)
	}

	/// Liquid-glass tabs at the bottom, Photos first.
	private var tabBar: some View {
		GlassEffectContainer(spacing: 0) {
			HStack(spacing: 4) {
				ForEach(AttachTab.allCases, id: \.self) { item in
					Button {
						withAnimation(.snappy) { tab = item }
					} label: {
						VStack(spacing: 3) {
							Image(systemName: item.symbol).font(.system(size: 19))
							Text(item.title).font(.caption2.weight(.medium))
						}
						.foregroundStyle(item == tab ? Theme.green : .primary)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 8)
						.background {
							if item == tab {
								Capsule().fill(Theme.green.opacity(0.14))
							}
						}
						.contentShape(Capsule())
					}
					.buttonStyle(.plain)
					.accessibilityAddTraits(item == tab ? .isSelected : [])
					.accessibilityIdentifier("attach.tab.\(item)")
				}
			}
			.padding(5)
			.glassEffect(.regular.interactive(), in: .capsule)
		}
		.padding(.horizontal, 24)
		.padding(.bottom, 8)
	}

	// MARK: Adding

	private func add(_ attachment: PromptAttachment) -> Bool {
		do {
			try draft.add(attachment)
			return true
		} catch PromptAttachmentError.tooMany {
			notice = L10n.Chat.attachTooMany(PromptDraft.maxAttachments)
		} catch PromptAttachmentError.tooLarge(let name) {
			notice = L10n.Chat.attachTooLarge(name)
		} catch {}
		return false
	}

	private func addPhotos() async {
		adding = true
		defer { adding = false }
		notice = nil
		var added = 0
		for item in photoItems {
			guard let data = try? await item.loadTransferable(type: Data.self),
			      let jpeg = ImageDownscaler.jpeg(from: data, maxBytes: PromptDraft.maxAttachmentBytes)
			else { continue }
			if add(PromptAttachment(kind: .image, name: "photo-\(draft.attachments.count + 1).jpg", mimeType: "image/jpeg", data: jpeg)) { added += 1 }
		}
		photoItems = []
		if notice == nil, added > 0 { dismiss() }
	}

	private func addPhoto(_ image: UIImage) {
		guard let jpeg = ImageDownscaler.jpeg(from: image, maxBytes: PromptDraft.maxAttachmentBytes) else { return }
		if add(PromptAttachment(kind: .image, name: "photo-\(draft.attachments.count + 1).jpg", mimeType: "image/jpeg", data: jpeg)) { dismiss() }
	}

	private func addFiles(_ urls: [URL]) {
		notice = nil
		var added = 0
		for url in urls {
			let scoped = url.startAccessingSecurityScopedResource()
			defer { if scoped { url.stopAccessingSecurityScopedResource() } }
			guard let data = try? Data(contentsOf: url) else { continue }
			let type = UTType(filenameExtension: url.pathExtension)
			let attachment = if type?.conforms(to: .image) == true, let jpeg = ImageDownscaler.jpeg(from: data, maxBytes: PromptDraft.maxAttachmentBytes) {
				PromptAttachment(kind: .image, name: url.deletingPathExtension().lastPathComponent + ".jpg", mimeType: "image/jpeg", data: jpeg)
			} else {
				PromptAttachment(kind: .file, name: url.lastPathComponent, mimeType: type?.preferredMIMEType ?? "application/octet-stream", data: data)
			}
			if add(attachment) { added += 1 }
		}
		if notice == nil, added > 0 { dismiss() }
	}

	#if DEBUG
	private func addSamples() {
		let image = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
			UIColor.systemGreen.setFill()
			context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
		}
		if let jpeg = image.jpegData(compressionQuality: 0.8) {
			_ = add(PromptAttachment(kind: .image, name: "photo-sample.jpg", mimeType: "image/jpeg", data: jpeg))
		}
		_ = add(PromptAttachment(kind: .file, name: "notes.txt", mimeType: "text/plain", data: Data("hello".utf8)))
		dismiss()
	}
	#endif
}

/// The system camera, for the Camera tab.
private struct CameraPicker: UIViewControllerRepresentable {
	var onFinish: (UIImage?) -> Void

	func makeUIViewController(context: Context) -> UIImagePickerController {
		let picker = UIImagePickerController()
		picker.sourceType = .camera
		picker.delegate = context.coordinator
		return picker
	}

	func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

	func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

	final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
		let onFinish: (UIImage?) -> Void

		init(onFinish: @escaping (UIImage?) -> Void) {
			self.onFinish = onFinish
		}

		func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
			onFinish(info[.originalImage] as? UIImage)
		}

		func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
			onFinish(nil)
		}
	}
}
