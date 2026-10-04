import CoreImage
import Metal
import UIKit

/// 룩 파라미터. "룩은 하나" 원칙이라 사용자에게 노출하지 않고 기본값으로 고정한다.
struct LookSettings: Equatable {
    var grain: Float = 0.085
    var vignette: Float = 0.32
    var fringe: Float = 1.0

    static let `default` = LookSettings()
}

/// Metal 기반 CIContext 를 하나만 들고 미리보기와 원본 현상에 같이 쓴다.
final class LookRenderer {
    static let shared = LookRenderer()

    /// 저장 사진의 긴 변 상한. 4:3 기준 12MP (4032×3024).
    static let maxLongEdge: CGFloat = 4032

    let device: MTLDevice
    let commandQueue: MTLCommandQueue
    let context: CIContext
    let outputColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private init() {
        guard let device = MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue()
        else { fatalError("Metal 을 사용할 수 없는 기기입니다.") }
        self.device = device
        self.commandQueue = queue
        self.context = CIContext(mtlCommandQueue: queue, options: [
            .cacheIntermediates: false,
            .name: "dica.look",
        ])
    }

    /// 입력 CIImage 에 디카 룩을 입힌다. seed 는 그레인 패턴을 바꾼다 (미리보기는 프레임마다 랜덤).
    func apply(_ image: CIImage, look: LookSettings, seed: Float) -> CIImage {
        let filter = DigicamFilter()
        filter.inputImage = image
        filter.grain = look.grain
        filter.vignette = look.vignette
        filter.fringe = look.fringe
        filter.seed = seed
        return filter.outputImage ?? image
    }

    /// 촬영 데이터(JPEG/HEIC)를 현상한다. EXIF 방향을 적용하고, 12MP 로 제한하고, 룩과 날짜 스탬프를 입힌다.
    func renderStill(from data: Data, look: LookSettings, stampDate: Date?) -> UIImage? {
        guard var image = CIImage(data: data, options: [.applyOrientationProperty: true]) else { return nil }

        let longEdge = max(image.extent.width, image.extent.height)
        if longEdge > Self.maxLongEdge {
            let scale = Self.maxLongEdge / longEdge
            image = image.applyingFilter("CILanczosScaleTransform", parameters: [
                kCIInputScaleKey: scale,
                kCIInputAspectRatioKey: 1.0,
            ])
        }

        // 원점을 (0,0) 으로 맞춰야 createCGImage 가 깔끔하게 잘린다
        image = image.transformed(by: CGAffineTransform(translationX: -image.extent.origin.x,
                                                        y: -image.extent.origin.y))
        let extent = image.extent.integral

        let output = apply(image, look: look, seed: 0.42).cropped(to: extent)
        guard let cgImage = context.createCGImage(output, from: extent, format: .RGBA8, colorSpace: outputColorSpace)
        else { return nil }

        let result = UIImage(cgImage: cgImage)
        if let stampDate {
            return DateStamp.draw(on: result, date: stampDate)
        }
        return result
    }
}
