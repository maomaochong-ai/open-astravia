import SwiftUI
import VettaKit

/// A panel from the chat's More menu, the phone's counterpart of a desktop activity panel tab.
struct SessionPanelSheet: View {
	let panel: SessionPanel
	let sessionId: String

	var body: some View {
		switch panel {
		case .files: FilesPanel(sessionId: sessionId)
		}
	}
}

private enum FileRoute: Hashable {
	case folder(RemoteFileEntry)
	case file(RemoteFileEntry)
}

/// The session's working directory on the desktop, read-only: folders open in
/// place, files open in a preview. Half height by default so the chat stays in
/// view; pulled down, it gives the chat back as it was.
struct FilesPanel: View {
	let sessionId: String

	var body: some View {
		NavigationStack {
			FolderView(sessionId: sessionId, path: "", title: L10n.Files.root)
				.navigationDestination(for: FileRoute.self) { route in
					switch route {
					case let .folder(entry): FolderView(sessionId: sessionId, path: entry.path, title: entry.name)
					case let .file(entry): FilePreviewScreen(sessionId: sessionId, path: entry.path, title: entry.name)
					}
				}
		}
		.presentationDetents([.medium, .large])
		.presentationDragIndicator(.visible)
	}
}

private struct FolderView: View {
	let sessionId: String
	let path: String
	let title: String

	@Environment(AppModel.self) private var model
	@State private var listing: FileListing?
	@State private var failure: FileViewError?

	private var active: Bool { model.transcript(sessionId).sessionState.status.isActive }

	var body: some View {
		content
			.navigationTitle(title)
			.navigationBarTitleDisplayMode(.inline)
			.task { await load() }
			// What the agent wrote shows up once its turn ends; a live watch would cost the desktop for every phone.
			.onChange(of: active) { wasActive, isActive in
				if wasActive, !isActive { Task { await load() } }
			}
	}

	@ViewBuilder
	private var content: some View {
		if let listing {
			if listing.entries.isEmpty {
				ScrollView {
					ContentUnavailableView(L10n.Files.empty, systemImage: "folder", description: Text(L10n.Files.emptyDescription))
						.padding(.top, 40)
				}
				.refreshable { await load() }
			} else {
				List(listing.entries) { entry in
					NavigationLink(value: entry.isDirectory ? FileRoute.folder(entry) : FileRoute.file(entry)) {
						FileRow(entry: entry)
					}
				}
				.listStyle(.plain)
				.refreshable { await load() }
			}
		} else if let failure {
			FileFailureView(failure: failure) { Task { await load() } }
		} else {
			ProgressView()
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	private func load() async {
		do {
			listing = try await model.listFiles(sessionId, path: path)
			failure = nil
		} catch {
			// Keep the last listing on screen when a refresh fails.
			if listing == nil { failure = error }
		}
	}
}

private struct FileRow: View {
	let entry: RemoteFileEntry

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: entry.isDirectory ? "folder.fill" : FileIcon.symbol(for: entry.name))
				.font(.system(size: 18))
				.foregroundStyle(entry.isDirectory ? Theme.blue : Theme.dim)
				.frame(width: 26)
			VStack(alignment: .leading, spacing: 3) {
				Text(entry.name)
					.font(.system(size: 15))
					.foregroundStyle(Theme.ink)
					.lineLimit(1)
					.truncationMode(.middle)
				Text(detail)
					.font(.system(size: 12))
					.foregroundStyle(Theme.dim)
			}
		}
		.padding(.vertical, 2)
	}

	private var detail: String {
		let time = TimeFormat.relative(entry.modifiedAt)
		guard !entry.isDirectory else { return time }
		return "\(FileIcon.size(entry.size)) · \(time)"
	}
}

enum FileIcon {
	static func symbol(for name: String) -> String {
		switch FileNames.extensionOf(name) {
		case "md", "markdown", "mdx", "txt", "log", "rtf": "doc.text"
		case "html", "htm", "xhtml": "globe"
		case "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "bmp", "tif", "tiff", "ico": "photo"
		case "pdf": "doc.richtext"
		case "csv", "tsv", "xls", "xlsx", "numbers": "tablecells"
		case "ppt", "pptx", "key": "rectangle.on.rectangle"
		case "doc", "docx", "pages": "doc"
		case "mp3", "m4a", "wav", "aac": "waveform"
		case "mp4", "m4v", "mov": "film"
		case "zip", "gz", "tgz", "7z", "rar": "archivebox"
		default: "chevron.left.forwardslash.chevron.right"
		}
	}

	static func size(_ bytes: Double) -> String {
		ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
	}
}

struct FileFailureView: View {
	let failure: FileViewError
	var retry: () -> Void

	var body: some View {
		ContentUnavailableView {
			Label(failure.message, systemImage: symbol)
		} actions: {
			if failure == .offline || failure == .failed {
				Button(L10n.Common.retry, action: retry)
					.buttonStyle(.glass)
			}
		}
	}

	private var symbol: String {
		switch failure {
		case .forbidden: "lock"
		case .notFound: "questionmark.folder"
		case .tooLarge: "externaldrive"
		case .offline: "wifi.slash"
		case .unsupportedDesktop: "arrow.down.circle"
		case .notAFile, .failed: "exclamationmark.triangle"
		}
	}
}
