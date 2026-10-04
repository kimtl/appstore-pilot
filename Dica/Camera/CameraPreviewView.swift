import CoreImage
import MetalKit
import SwiftUI

/// 카메라 프레임에 디카 룩을 실시간으로 입혀 보여주는 MTKView.
/// 30fps 로 계속 그리므로 새 프레임이 없어도 그레인이 살아 움직인다 (디카 액정 느낌).
struct CameraPreviewView: UIViewRepresentable {
    let camera: CameraService
    let look: LookSettings

    func makeCoordinator() -> Coordinator {
        Coordinator(camera: camera, look: look)
    }

    func makeUIView(context: Context) -> MTKView {
        let view = MTKView(frame: .zero, device: LookRenderer.shared.device)
        view.framebufferOnly = false
        view.colorPixelFormat = .bgra8Unorm
        view.preferredFramesPerSecond = 30
        view.isPaused = false
        view.enableSetNeedsDisplay = false
        view.backgroundColor = .black
        view.delegate = context.coordinator
        return view
    }

    func updateUIView(_ uiView: MTKView, context: Context) {
        context.coordinator.look = look
    }

    final class Coordinator: NSObject, MTKViewDelegate {
        let camera: CameraService
        var look: LookSettings
        private let renderer = LookRenderer.shared

        init(camera: CameraService, look: LookSettings) {
            self.camera = camera
            self.look = look
        }

        func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

        func draw(in view: MTKView) {
            let drawableSize = view.drawableSize
            guard drawableSize.width > 0, drawableSize.height > 0,
                  let frame = camera.latestFrame,
                  let drawable = view.currentDrawable,
                  let commandBuffer = renderer.commandQueue.makeCommandBuffer()
            else { return }

            // 화면 픽셀 크기로 먼저 맞춘 뒤 룩을 입혀야 그레인이 화면 픽셀 단위로 또렷하게 나온다
            let scale = max(drawableSize.width / frame.extent.width,
                            drawableSize.height / frame.extent.height)
            var image = frame.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            image = renderer.apply(image, look: look, seed: Float.random(in: 0..<1))

            let dx = (drawableSize.width - image.extent.width) / 2 - image.extent.origin.x
            let dy = (drawableSize.height - image.extent.height) / 2 - image.extent.origin.y
            image = image.transformed(by: CGAffineTransform(translationX: dx, y: dy))

            renderer.context.render(image,
                                    to: drawable.texture,
                                    commandBuffer: commandBuffer,
                                    bounds: CGRect(origin: .zero, size: drawableSize),
                                    colorSpace: renderer.outputColorSpace)
            commandBuffer.present(drawable)
            commandBuffer.commit()
        }
    }
}
