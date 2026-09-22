@preconcurrency import AVFoundation
import SwiftUI
import UIKit

enum CameraAccess {
	case unknown, granted, denied, unavailable

	static var current: CameraAccess {
		guard AVCaptureDevice.default(for: .video) != nil else { return .unavailable }
		switch AVCaptureDevice.authorizationStatus(for: .video) {
		case .authorized: return .granted
		case .notDetermined: return .unknown
		default: return .denied
		}
	}

	static func request() async -> CameraAccess {
		guard AVCaptureDevice.default(for: .video) != nil else { return .unavailable }
		return await AVCaptureDevice.requestAccess(for: .video) ? .granted : .denied
	}
}

/// Back camera preview that reports every QR payload it sees while `active`.
struct QRScannerView: UIViewRepresentable {
	var active: Bool
	var onCode: (String) -> Void

	func makeUIView(context: Context) -> PreviewView {
		let view = PreviewView()
		view.onCode = onCode
		view.configure()
		return view
	}

	func updateUIView(_ view: PreviewView, context: Context) {
		view.onCode = onCode
		view.setRunning(active)
	}

	static func dismantleUIView(_ view: PreviewView, coordinator: ()) {
		view.setRunning(false)
	}

	final class PreviewView: UIView, AVCaptureMetadataOutputObjectsDelegate {
		override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
		private let session = AVCaptureSession()
		private let queue = DispatchQueue(label: "com.openvetta.mobile.camera")
		var onCode: ((String) -> Void)?

		private var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

		func configure() {
			previewLayer.session = session
			previewLayer.videoGravity = .resizeAspectFill
			guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
			      let input = try? AVCaptureDeviceInput(device: device),
			      session.canAddInput(input)
			else { return }
			session.beginConfiguration()
			session.addInput(input)
			let output = AVCaptureMetadataOutput()
			if session.canAddOutput(output) {
				session.addOutput(output)
				output.setMetadataObjectsDelegate(self, queue: .main)
				output.metadataObjectTypes = output.availableMetadataObjectTypes.contains(.qr) ? [.qr] : []
			}
			session.commitConfiguration()
		}

		func setRunning(_ running: Bool) {
			let session = session
			queue.async {
				if running, !session.isRunning { session.startRunning() }
				if !running, session.isRunning { session.stopRunning() }
			}
		}

		nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
			let codes = metadataObjects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
			guard let code = codes.first else { return }
			MainActor.assumeIsolated { onCode?(code) }
		}
	}
}
