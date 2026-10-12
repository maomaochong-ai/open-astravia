import MetalKit
@preconcurrency import WebRTC

/// Owns the display policy while WebRTC retains pixel conversion and GPU resources.
/// The pinned SDK exposes its MTKView as a subview but no display-budget settings;
/// keep that dependency here and exercise it with the actual binary in component tests.
final class RemoteMetalVideoView: RTCMTLVideoView {
	private weak var metalView: MTKView?
	private var drawing: RemoteMetalDrawing?
	private var sourceSize = CGSize.zero

	init() {
		super.init(frame: .zero)
		guard let metal = subviews.compactMap({ $0 as? MTKView }).first, let renderer = metal.delegate else {
			assertionFailure("WebRTC's Metal view must expose its drawing surface and delegate")
			return
		}
		metalView = metal
		let drawing = RemoteMetalDrawing(owner: self, renderer: renderer)
		self.drawing = drawing
		metal.delegate = drawing
		updateDisplayBudget()
		registerForTraitChanges([UITraitDisplayScale.self]) { (view: RemoteMetalVideoView, _: UITraitCollection) in
			view.setNeedsLayout()
		}
	}

	@available(*, unavailable)
	required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

	override nonisolated func setSize(_ size: CGSize) {
		// Like WebRTC's size callback, this can arrive on the video worker thread.
		DispatchQueue.main.async { [weak self] in
			self?.setSourceSize(size)
		}
	}

	private func setSourceSize(_ size: CGSize) {
		sourceSize = size
		super.setSize(size)
		setNeedsLayout()
	}

	override func layoutSubviews() {
		super.layoutSubviews()
		// WebRTC's layout otherwise multiplies source *pixels* by the Retina scale.
		updateDisplayBudget()
	}

	override func didMoveToWindow() {
		super.didMoveToWindow()
		updateDisplayBudget()
	}

	fileprivate func updateDisplayBudget() {
		guard let metal = metalView else { return }
		let screenRate = window?.windowScene?.screen.maximumFramesPerSecond ?? 60
		let frameRate = min(60, max(1, screenRate))
		if metal.preferredFramesPerSecond != frameRate { metal.preferredFramesPerSecond = frameRate }
		if metal.autoResizeDrawable { metal.autoResizeDrawable = false }
		guard sourceSize.width > 0, sourceSize.height > 0, bounds.width > 0, bounds.height > 0 else { return }
		let scale = max(traitCollection.displayScale, 1)
		let fraction = min(1, max(bounds.width * scale / sourceSize.width, bounds.height * scale / sourceSize.height))
		let pixels = CGSize(width: ceil(sourceSize.width * fraction), height: ceil(sourceSize.height * fraction))
		if metal.drawableSize != pixels { metal.drawableSize = pixels }
	}
}

/// MTKView's display callbacks run on the UI thread. The weak references avoid a
/// cycle through the WebRTC view, which is also the original drawing delegate.
private final class RemoteMetalDrawing: NSObject, MTKViewDelegate {
	private weak var owner: RemoteMetalVideoView?
	private weak var renderer: (any MTKViewDelegate)?

	init(owner: RemoteMetalVideoView, renderer: any MTKViewDelegate) {
		self.owner = owner
		self.renderer = renderer
	}

	func draw(in view: MTKView) {
		owner?.updateDisplayBudget()
		renderer?.draw(in: view)
		// The first NV12/I420/RGB frame lazily initializes its shader and sets 30 fps.
		// Restore the policy after every draw, including pixel-format changes.
		owner?.updateDisplayBudget()
	}

	func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
		renderer?.mtkView(view, drawableSizeWillChange: size)
	}
}
