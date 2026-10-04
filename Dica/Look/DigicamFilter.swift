import CoreImage

/// DigicamKernel.ci.metal 의 `digicam` 커널을 감싸는 CIFilter.
/// CIFilter 는 스레드 안전하지 않으므로 호출마다 새로 만들어 쓴다 (커널 로드는 한 번만).
final class DigicamFilter: CIFilter {
    private static let kernel: CIKernel = {
        guard let url = Bundle.main.url(forResource: "default", withExtension: "metallib"),
              let data = try? Data(contentsOf: url),
              let kernel = try? CIKernel(functionName: "digicam", fromMetalLibraryData: data)
        else {
            fatalError("digicam 커널을 default.metallib 에서 찾지 못했습니다. project.yml 의 MTL_COMPILER_FLAGS(-fcikernel) 설정을 확인하세요.")
        }
        return kernel
    }()

    var inputImage: CIImage?
    var grain: Float = 0.085
    var vignette: Float = 0.32
    var fringe: Float = 1.0
    var seed: Float = 0

    override var outputImage: CIImage? {
        guard let inputImage else { return nil }
        let extent = inputImage.extent
        // 색수차가 가장자리 바깥을 샘플링하면 투명 픽셀이 섞여 테두리에 청록 선이 생긴다.
        // 가장자리 픽셀을 바깥으로 늘린 이미지를 커널에 넘기고 결과를 원래 크기로 자른다.
        let clamped = inputImage.clampedToExtent()
        return Self.kernel.apply(
            extent: extent,
            // 색수차 샘플링이 주변 픽셀을 읽으므로 ROI 를 넉넉히 넓힌다 (최대 오프셋 약 7px)
            roiCallback: { _, rect in rect.insetBy(dx: -32, dy: -32) },
            arguments: [clamped, CIVector(cgRect: extent), grain, vignette, fringe, seed]
        )?.cropped(to: extent)
    }
}
