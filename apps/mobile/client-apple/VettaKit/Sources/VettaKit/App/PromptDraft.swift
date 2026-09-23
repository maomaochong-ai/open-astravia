import Foundation

/// One picture or file the user attached to a prompt, held in memory until it is sent.
public struct PromptAttachment: Equatable, Identifiable, Sendable {
	public enum Kind: String, Codable, Sendable {
		case image, file
	}

	public var id: String
	public var kind: Kind
	public var name: String
	public var mimeType: String
	public var data: Data

	public init(id: String = UUID().uuidString, kind: Kind, name: String, mimeType: String, data: Data) {
		self.id = id
		self.kind = kind
		self.name = name
		self.mimeType = mimeType
		self.data = data
	}

	var json: JSONValue {
		[
			"kind": .string(kind.rawValue),
			"name": .string(name),
			"mimeType": .string(mimeType),
			"data": .string(data.base64EncodedString()),
		]
	}
}

public enum PromptAttachmentError: Error, Equatable {
	case tooLarge(name: String)
	case tooMany
}

/// What the composer holds before sending: text plus attachments, within the
/// limits the link can carry in one encrypted frame.
public struct PromptDraft: Equatable, Sendable {
	/// Per attachment, before base64: what one `session.upload` frame carries.
	/// Pictures are downscaled to fit; other files are refused.
	public static let maxAttachmentBytes = RemoteAPI.maxUploadBytes
	public static let maxAttachments = 6

	public var text = ""
	public private(set) var attachments: [PromptAttachment] = []

	public init(text: String = "", attachments: [PromptAttachment] = []) {
		self.text = text
		self.attachments = attachments
	}

	public var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

	/// A prompt needs words; attachments ride along with them.
	public var canSend: Bool { !trimmedText.isEmpty }

	public var isEmpty: Bool { trimmedText.isEmpty && attachments.isEmpty }

	public mutating func add(_ attachment: PromptAttachment) throws {
		guard attachments.count < Self.maxAttachments else { throw PromptAttachmentError.tooMany }
		guard !attachment.data.isEmpty, attachment.data.count <= Self.maxAttachmentBytes else {
			throw PromptAttachmentError.tooLarge(name: attachment.name)
		}
		attachments.append(attachment)
	}

	public mutating func remove(_ id: String) {
		attachments.removeAll { $0.id == id }
	}

	public mutating func clear() {
		text = ""
		attachments = []
	}
}
