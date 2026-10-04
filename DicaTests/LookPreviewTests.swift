import UIKit
import XCTest
@testable import Dica

/// 카메라 없이 룩 파이프라인을 돌려 결과 이미지를 파일로 남기는 테스트.
///
/// 출력 폴더: 환경변수 `DICA_OUTPUT_DIR` (xcodebuild 에서는 `TEST_RUNNER_DICA_OUTPUT_DIR`), 없으면 임시 폴더.
/// 결과는 XCTAttachment 로도 남겨 .xcresult 에서 볼 수 있다.
final class LookPreviewTests: XCTestCase {
    private static let stampDate: Date = {
        var components = DateComponents()
        components.year = 2026
        components.month = 10
        components.day = 4
        return Calendar(identifier: .gregorian).date(from: components)!
    }()

    private var outputDirectory: URL!

    override func setUpWithError() throws {
        let path = ProcessInfo.processInfo.environment["DICA_OUTPUT_DIR"]
            ?? (NSTemporaryDirectory() as NSString).appendingPathComponent("dica-look")
        outputDirectory = URL(fileURLWithPath: path, isDirectory: true)
        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        print("DICA_OUTPUT_DIR=\(outputDirectory.path)")
    }

    // MARK: - 테스트

    /// 합성 컬러 차트. 색상환, 그레이 램프, 피부톤/기억색 패치가 룩을 거치며 어떻게 변하는지 본다.
    func testColorChart() throws {
        let chart = Self.makeColorChart(size: CGSize(width: 1600, height: 1200))
        let data = try XCTUnwrap(chart.jpegData(compressionQuality: 0.95))
        let after = try XCTUnwrap(LookRenderer.shared.renderStill(from: data, look: .default, stampDate: Self.stampDate))
        XCTAssertEqual(after.size.width, 1600, accuracy: 1)
        XCTAssertEqual(after.size.height, 1200, accuracy: 1)
        try save(Self.sideBySide(chart, after), name: "chart_compare.jpg")
    }

    /// Fixtures 의 실제 사진. 원본과 결과를 나란히 붙인 비교 이미지와 결과 단독 이미지를 남긴다.
    func testSamplePhotos() throws {
        let urls = Self.fixtureURLs()
        try XCTSkipIf(urls.isEmpty, "DicaTests/Fixtures 에 jpg 가 없습니다.")

        for url in urls {
            let data = try Data(contentsOf: url)
            let before = try XCTUnwrap(UIImage(data: data))
            let after = try XCTUnwrap(
                LookRenderer.shared.renderStill(from: data, look: .default, stampDate: Self.stampDate),
                "\(url.lastPathComponent) 현상 실패"
            )
            XCTAssertGreaterThan(after.size.width, 0)

            let name = url.deletingPathExtension().lastPathComponent
            try save(after, name: "\(name)_dica.jpg")
            try save(Self.sideBySide(before, after), name: "\(name)_compare.jpg")
        }
    }

    /// 파라미터를 바꿔 가며 2×2 로 붙인 튜닝용 시트.
    func testVariants() throws {
        let source: Data
        if let first = Self.fixtureURLs().first {
            source = try Data(contentsOf: first)
        } else {
            source = try XCTUnwrap(Self.makeColorChart(size: CGSize(width: 1600, height: 1200)).jpegData(compressionQuality: 0.95))
        }

        var strongGrain = LookSettings.default
        strongGrain.grain *= 2
        var strongVignette = LookSettings.default
        strongVignette.vignette = 0.55
        var noFringe = LookSettings.default
        noFringe.fringe = 0

        let variants: [(String, LookSettings)] = [
            ("기본", .default),
            ("그레인 2배", strongGrain),
            ("비네팅 강하게", strongVignette),
            ("색수차 없음", noFringe),
        ]

        var tiles: [(String, UIImage)] = []
        for (label, look) in variants {
            let image = try XCTUnwrap(LookRenderer.shared.renderStill(from: source, look: look, stampDate: Self.stampDate), label)
            tiles.append((label, image))
        }
        try save(Self.grid(tiles, columns: 2, tileWidth: 900), name: "variants.jpg")
    }

    // MARK: - 입출력

    private static func fixtureURLs() -> [URL] {
        let bundle = Bundle(for: LookPreviewTests.self)
        let urls = (bundle.urls(forResourcesWithExtension: "jpg", subdirectory: nil) ?? [])
            + (bundle.urls(forResourcesWithExtension: "jpeg", subdirectory: nil) ?? [])
        return urls.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func save(_ image: UIImage, name: String) throws {
        let data = try XCTUnwrap(image.jpegData(compressionQuality: 0.9))
        let url = outputDirectory.appendingPathComponent(name)
        try data.write(to: url)
        print("saved \(url.path) (\(data.count / 1024) KB)")

        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - 이미지 합성

    /// 원본 | 결과 를 가로로 붙인다. 전체 폭을 maxWidth 로 제한한다.
    static func sideBySide(_ left: UIImage, _ right: UIImage, maxWidth: CGFloat = 2000) -> UIImage {
        let gap: CGFloat = 8
        let scale = min(1, (maxWidth - gap) / (left.size.width + right.size.width))
        let leftSize = CGSize(width: left.size.width * scale, height: left.size.height * scale)
        let rightSize = CGSize(width: right.size.width * scale, height: right.size.height * scale)
        let size = CGSize(width: leftSize.width + gap + rightSize.width,
                          height: max(leftSize.height, rightSize.height))

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            left.draw(in: CGRect(origin: .zero, size: leftSize))
            right.draw(in: CGRect(origin: CGPoint(x: leftSize.width + gap, y: 0), size: rightSize))
        }
    }

    /// 라벨이 달린 타일을 격자로 붙인다.
    static func grid(_ tiles: [(String, UIImage)], columns: Int, tileWidth: CGFloat) -> UIImage {
        guard let first = tiles.first?.1 else { return UIImage() }
        let aspect = first.size.height / first.size.width
        let tileHeight = tileWidth * aspect
        let labelHeight: CGFloat = 48
        let gap: CGFloat = 8
        let rows = Int(ceil(Double(tiles.count) / Double(columns)))
        let size = CGSize(width: CGFloat(columns) * tileWidth + CGFloat(columns - 1) * gap,
                          height: CGFloat(rows) * (tileHeight + labelHeight) + CGFloat(rows - 1) * gap)

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))

            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 28, weight: .semibold),
                .foregroundColor: UIColor.white,
            ]
            for (index, tile) in tiles.enumerated() {
                let column = index % columns
                let row = index / columns
                let x = CGFloat(column) * (tileWidth + gap)
                let y = CGFloat(row) * (tileHeight + labelHeight + gap)
                NSAttributedString(string: tile.0, attributes: attributes)
                    .draw(at: CGPoint(x: x + 12, y: y + 10))
                tile.1.draw(in: CGRect(x: x, y: y + labelHeight, width: tileWidth, height: tileHeight))
            }
        }
    }

    /// 색상환(위, 아래로 갈수록 어두움) + 그레이 램프(가운데) + 피부톤/기억색 패치(아래).
    static func makeColorChart(size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext

            let bands = 24
            let rows = 6
            let bandWidth = size.width / CGFloat(bands)
            let rowHeight = size.height * 0.5 / CGFloat(rows)
            for row in 0..<rows {
                for band in 0..<bands {
                    let hue = CGFloat(band) / CGFloat(bands)
                    let brightness = 1.0 - CGFloat(row) / CGFloat(rows) * 0.85
                    UIColor(hue: hue, saturation: 0.85, brightness: brightness, alpha: 1).setFill()
                    cg.fill(CGRect(x: CGFloat(band) * bandWidth, y: CGFloat(row) * rowHeight,
                                   width: bandWidth + 1, height: rowHeight + 1))
                }
            }

            let steps = 21
            let stepWidth = size.width / CGFloat(steps)
            let rampY = size.height * 0.5
            let rampHeight = size.height * 0.2
            for step in 0..<steps {
                UIColor(white: CGFloat(step) / CGFloat(steps - 1), alpha: 1).setFill()
                cg.fill(CGRect(x: CGFloat(step) * stepWidth, y: rampY, width: stepWidth + 1, height: rampHeight))
            }

            let patches: [(CGFloat, CGFloat, CGFloat)] = [
                (0.96, 0.80, 0.69), (0.87, 0.67, 0.53), (0.76, 0.55, 0.40), (0.55, 0.36, 0.25), (0.36, 0.22, 0.15),
                (0.54, 0.71, 0.35), (0.36, 0.55, 0.80), (0.85, 0.30, 0.25), (0.95, 0.85, 0.30), (0.60, 0.45, 0.70),
            ]
            let patchWidth = size.width / CGFloat(patches.count)
            let patchY = size.height * 0.7
            let patchHeight = size.height * 0.3
            for (index, patch) in patches.enumerated() {
                UIColor(red: patch.0, green: patch.1, blue: patch.2, alpha: 1).setFill()
                cg.fill(CGRect(x: CGFloat(index) * patchWidth, y: patchY, width: patchWidth + 1, height: patchHeight))
            }
        }
    }
}
