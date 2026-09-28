import QuickLook
import SwiftUI
import VettaKit
import WebKit

/// One desktop file on the phone. `path` is whatever names it: a path from the
/// files panel, or a reply's link exactly as written, which the desktop resolves.
struct FilePreviewScreen: View {
	let sessionId: String
	let path: String
	/// Shown until the desktop has described the file.
	var title: String

	@Environment(AppModel.self) private var model
	@State private var info: RemoteFileInfo?
	@State private var loaded: LoadedFile?
	@State private var failure: FileViewError?
	/// The desktop's copy changed after this one was fetched.
	@State private var changed = false

	private var active: Bool { model.transcript(sessionId).sessionState.status.isActive }

	var body: some View {
		VStack(spacing: 0) {
			if changed {
				Button {
					Task { await load() }
				} label: {
					Label(L10n.Files.updated, systemImage: "arrow.clockwise")
						.font(.system(size: 13, weight: .medium))
						.frame(maxWidth: .infinity)
						.padding(.vertical, 10)
				}
				.buttonStyle(.plain)
				.foregroundStyle(Theme.blue)
				.background(Theme.blue.opacity(0.1))
			}
			content
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.background(Theme.page)
		.navigationTitle(info?.name ?? title)
		.navigationBarTitleDisplayMode(.inline)
		.toolbar {
			if let info {
				ToolbarItem(placement: .principal) {
					VStack(spacing: 1) {
						Text(info.name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
						Text(info.displayPath).font(.system(size: 11)).foregroundStyle(Theme.dim).lineLimit(1).truncationMode(.head)
					}
				}
			}
			if let loaded {
				ToolbarItem(placement: .topBarTrailing) {
					ShareLink(item: loaded.url) {
						Image(systemName: "square.and.arrow.up")
					}
					.accessibilityLabel(L10n.Files.share)
				}
			}
		}
		.task { await load() }
		// Only noticed, not reloaded: a preview does not change under the reader.
		.onChange(of: active) { wasActive, isActive in
			if wasActive, !isActive { Task { await checkForChanges() } }
		}
	}

	@ViewBuilder
	private var content: some View {
		if let loaded {
			switch loaded.kind {
			case .markdown:
				ScrollView {
					MarkdownView(text: loaded.text ?? "")
						.padding(20)
				}
			case .html:
				HTMLPreview(html: loaded.text ?? "")
			case .text:
				TextPreview(text: loaded.text ?? "")
			case .quickLook:
				QuickLookPreview(url: loaded.url)
			case .unsupported:
				ContentUnavailableView {
					Label(L10n.Files.unsupported, systemImage: FileIcon.symbol(for: loaded.url.lastPathComponent))
				} description: {
					Text(FileIcon.size(Double(loaded.size)))
				} actions: {
					ShareLink(item: loaded.url) { Text(L10n.Files.share) }
						.buttonStyle(.glass)
				}
			}
		} else if let failure {
			FileFailureView(failure: failure) { Task { await load() } }
		} else {
			ProgressView(L10n.Files.loading)
		}
	}

	private func load() async {
		failure = nil
		changed = false
		do {
			let described = try await model.statFile(sessionId, path: path)
			info = described
			// A link to a folder, or a file past the limit that no scaling can shrink.
			guard !described.entry.isDirectory else { throw FileViewError.notAFile }
			let content = try await model.readFile(sessionId, described)
			loaded = try LoadedFile(info: described, content: content)
		} catch {
			loaded = nil
			failure = FileViewError.from(error)
		}
	}

	private func checkForChanges() async {
		guard let info, let latest = try? await model.statFile(sessionId, path: info.path) else { return }
		changed = latest.entry.modifiedAt != info.entry.modifiedAt || latest.entry.size != info.entry.size
	}
}

/// A fetched file, written to a temporary file for Quick Look and sharing.
private struct LoadedFile {
	let url: URL
	let kind: FilePreviewKind
	let text: String?
	let size: Int

	init(info: RemoteFileInfo, content: FileContent) throws {
		let folder = FileManager.default.temporaryDirectory
			.appendingPathComponent("desktop-files", isDirectory: true)
			.appendingPathComponent(UUID().uuidString, isDirectory: true)
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		// A photo scaled down on the desktop arrives as JPEG; name it so for Quick Look and the share sheet.
		var name = info.name
		if content.mimeType == "image/jpeg", !["jpg", "jpeg"].contains(FileNames.extensionOf(name)) {
			name = (name as NSString).deletingPathExtension + ".jpg"
		}
		url = folder.appendingPathComponent(name)
		try content.data.write(to: url, options: .atomic)
		kind = FilePreviewKind.of(name: info.name, mimeType: content.mimeType, data: content.data)
		text = kind == .markdown || kind == .html || kind == .text ? FileText.decode(content.data) : nil
		size = content.data.count
	}
}

/// Read-only text in a UIKit view, which lays out a long file far faster than `Text`.
private struct TextPreview: UIViewRepresentable {
	let text: String

	func makeUIView(context: Context) -> UITextView {
		let view = UITextView()
		view.isEditable = false
		view.isSelectable = true
		view.backgroundColor = .clear
		view.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
		view.textColor = .label
		view.textContainerInset = UIEdgeInsets(top: 16, left: 14, bottom: 24, right: 14)
		view.alwaysBounceVertical = true
		return view
	}

	func updateUIView(_ view: UITextView, context: Context) {
		if view.text != text { view.text = text }
	}
}

/// An HTML file as a page. Scripts run, since generated pages usually need them,
/// but nothing is stored and links leave for Safari; files it references beside
/// it on the desktop are not loaded.
private struct HTMLPreview: UIViewRepresentable {
	let html: String

	func makeCoordinator() -> Coordinator { Coordinator() }

	func makeUIView(context: Context) -> WKWebView {
		let configuration = WKWebViewConfiguration()
		configuration.websiteDataStore = .nonPersistent()
		let view = WKWebView(frame: .zero, configuration: configuration)
		view.navigationDelegate = context.coordinator
		view.isOpaque = false
		view.backgroundColor = .clear
		return view
	}

	func updateUIView(_ view: WKWebView, context: Context) {
		guard context.coordinator.loaded != html else { return }
		context.coordinator.loaded = html
		view.loadHTMLString(html, baseURL: nil)
	}

	final class Coordinator: NSObject, WKNavigationDelegate {
		var loaded: String?

		func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
			guard action.navigationType == .linkActivated else { return .allow }
			if let url = action.request.url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
				await UIApplication.shared.open(url)
			}
			return .cancel
		}
	}
}

/// Quick Look inline, for images, PDF, Office and iWork documents and media.
private struct QuickLookPreview: UIViewControllerRepresentable {
	let url: URL

	func makeCoordinator() -> Coordinator { Coordinator(url: url) }

	func makeUIViewController(context: Context) -> QLPreviewController {
		let controller = QLPreviewController()
		controller.dataSource = context.coordinator
		return controller
	}

	func updateUIViewController(_ controller: QLPreviewController, context: Context) {
		guard context.coordinator.url != url else { return }
		context.coordinator.url = url
		controller.reloadData()
	}

	final class Coordinator: NSObject, QLPreviewControllerDataSource {
		var url: URL

		init(url: URL) {
			self.url = url
		}

		func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

		func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
			url as NSURL
		}
	}
}
