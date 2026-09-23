import Photos
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VettaKit

/// The attach button's sheet, like Gemini's: a row that scrolls sideways with
/// Photos, Camera and the newest pictures in the library, then a list of other
/// sources (for now only Files). Tapping a recent picture attaches it at once.
struct AttachmentSheet: View {
	@Binding var draft: PromptDraft
	@Environment(\.dismiss) private var dismiss
	@State private var recent: [PHAsset] = []
	@State private var photoItems: [PhotosPickerItem] = []
	@State private var pickingPhotos = false
	@State private var pickingFiles = false
	@State private var shooting = false
	@State private var adding = false
	@State private var notice: String?
	@State private var height: CGFloat = 300

	private static let tileSize = CGSize(width: 104, height: 116)
	private static let tileShape = RoundedRectangle(cornerRadius: 26, style: .continuous)
	private static let recentLimit = 24

	private var room: Int { max(0, PromptDraft.maxAttachments - draft.attachments.count) }

	#if DEBUG
	/// The Photos, Files and camera pickers run out of process; UI tests attach through a sample row instead.
	private var uiTesting: Bool { ProcessInfo.processInfo.arguments.contains("-VettaUITestAttachments") }
	#endif

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			strip
				.padding(.top, 28)
			if let notice {
				Text(notice)
					.font(.caption)
					.foregroundStyle(Theme.red)
					.padding(.horizontal, 24)
					.padding(.top, 10)
					.accessibilityIdentifier("attach.notice")
			}
			VStack(spacing: 0) {
				row(symbol: "folder", title: L10n.Chat.attachFiles, detail: L10n.Chat.attachFilesHint, identifier: "attach.files") {
					pickingFiles = true
				}
				#if DEBUG
				if uiTesting {
					row(symbol: "ladybug", title: "Samples", detail: nil, identifier: "composer.attach.sample", perform: addSamples)
				}
				#endif
			}
			.padding(.top, 12)
		}
		.padding(.bottom, 12)
		.onGeometryChange(for: CGFloat.self, of: Self.contentHeight) { height = $0 }
		.presentationDetents([.height(height)])
		.presentationDragIndicator(.visible)
		.task { await loadRecent() }
		.photosPicker(
			isPresented: $pickingPhotos,
			selection: $photoItems,
			maxSelectionCount: max(1, room),
			selectionBehavior: .ordered,
			matching: .images,
			photoLibrary: .shared()
		)
		.onChange(of: photoItems) { _, items in
			if !items.isEmpty { Task { await addPhotos(items) } }
		}
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

	/// Runs during layout, off the main actor on a device.
	private nonisolated static func contentHeight(_ geometry: GeometryProxy) -> CGFloat {
		geometry.size.height
	}

	// MARK: Sections

	private var strip: some View {
		ScrollView(.horizontal) {
			HStack(spacing: 10) {
				tile(symbol: "photo.badge.plus", title: L10n.Chat.attachPhotos, identifier: "attach.photos") {
					notice = nil
					pickingPhotos = true
				}
				tile(symbol: "camera", title: L10n.Chat.attachCamera, identifier: "attach.camera") {
					if UIImagePickerController.isSourceTypeAvailable(.camera) {
						notice = nil
						shooting = true
					} else {
						notice = L10n.Chat.cameraUnavailable
					}
				}
				ForEach(recent, id: \.localIdentifier) { asset in
					Button { Task { await addRecent(asset) } } label: {
						RecentPhoto(asset: asset, size: Self.tileSize)
							.frame(width: Self.tileSize.width, height: Self.tileSize.height)
							.clipShape(Self.tileShape)
							.contentShape(Self.tileShape)
					}
					.buttonStyle(.plain)
					.disabled(adding)
					.accessibilityLabel(L10n.Chat.attachRecent)
					.accessibilityIdentifier("attach.recent")
				}
			}
			.padding(.horizontal, 20)
		}
		.scrollIndicators(.hidden)
	}

	private func tile(symbol: String, title: String, identifier: String, perform: @escaping () -> Void) -> some View {
		Button(action: perform) {
			VStack(spacing: 10) {
				Image(systemName: symbol).font(.system(size: 24))
				Text(title).font(.headline)
			}
			.foregroundStyle(.primary)
			.frame(width: Self.tileSize.width, height: Self.tileSize.height)
			.contentShape(Self.tileShape)
		}
		.buttonStyle(.plain)
		.glassEffect(.regular.interactive(), in: Self.tileShape)
		.accessibilityIdentifier(identifier)
	}

	private func row(symbol: String, title: String, detail: String?, identifier: String, perform: @escaping () -> Void) -> some View {
		Button(action: perform) {
			HStack(spacing: 16) {
				Image(systemName: symbol)
					.font(.system(size: 20))
					.frame(width: 28)
				VStack(alignment: .leading, spacing: 2) {
					Text(title).font(.body)
					if let detail {
						Text(detail)
							.font(.subheadline)
							.foregroundStyle(.secondary)
					}
				}
				Spacer(minLength: 0)
			}
			.foregroundStyle(.primary)
			.padding(.horizontal, 24)
			.padding(.vertical, 12)
			.contentShape(.rect)
		}
		.buttonStyle(.plain)
		.accessibilityElement(children: .combine)
		.accessibilityIdentifier(identifier)
	}

	// MARK: Library

	/// The newest pictures, if the library may be read. Asks the first time the sheet opens.
	private func loadRecent() async {
		var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
		if status == .notDetermined {
			status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
		}
		guard status == .authorized || status == .limited else { return }
		let options = PHFetchOptions()
		options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
		options.fetchLimit = Self.recentLimit
		let result = PHAsset.fetchAssets(with: .image, options: options)
		var assets: [PHAsset] = []
		result.enumerateObjects { asset, _, _ in assets.append(asset) }
		recent = assets
	}

	private func addRecent(_ asset: PHAsset) async {
		adding = true
		defer { adding = false }
		notice = nil
		guard let data = await Self.imageData(for: asset),
		      let jpeg = ImageDownscaler.jpeg(from: data, maxBytes: PromptDraft.maxAttachmentBytes)
		else { return }
		if add(PromptAttachment(kind: .image, name: "photo-\(draft.attachments.count + 1).jpg", mimeType: "image/jpeg", data: jpeg)) { dismiss() }
	}

	/// The full picture, fetched from iCloud when only a preview is on the phone.
	private static func imageData(for asset: PHAsset) async -> Data? {
		let options = PHImageRequestOptions()
		options.isNetworkAccessAllowed = true
		options.deliveryMode = .highQualityFormat
		options.version = .current
		return await withCheckedContinuation { continuation in
			PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { @Sendable data, _, _, _ in
				continuation.resume(returning: data)
			}
		}
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

	private func addPhotos(_ items: [PhotosPickerItem]) async {
		adding = true
		defer { adding = false }
		notice = nil
		var added = 0
		for item in items {
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

/// One recent picture in the sheet's strip, filled to its tile.
private struct RecentPhoto: View {
	let asset: PHAsset
	let size: CGSize
	@Environment(\.displayScale) private var scale
	@State private var image: UIImage?

	var body: some View {
		ZStack {
			Theme.card2
			if let image {
				Image(uiImage: image)
					.resizable()
					.scaledToFill()
					.frame(width: size.width, height: size.height)
			}
		}
		.task(id: asset.localIdentifier) {
			image = await Self.thumbnail(for: asset, size: CGSize(width: size.width * scale, height: size.height * scale))
		}
	}

	private static func thumbnail(for asset: PHAsset, size: CGSize) async -> UIImage? {
		let options = PHImageRequestOptions()
		options.isNetworkAccessAllowed = true
		options.deliveryMode = .highQualityFormat
		options.resizeMode = .fast
		return await withCheckedContinuation { continuation in
			PHImageManager.default().requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { @Sendable image, _ in
				continuation.resume(returning: image)
			}
		}
	}
}

/// The system camera, for the Camera tile.
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
