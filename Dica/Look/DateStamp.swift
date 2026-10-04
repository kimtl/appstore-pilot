import SwiftUI
import UIKit

/// 디카 특유의 주황색 날짜 스탬프 ('26 10 04).
enum DateStamp {
    static let color = Color(red: 1.0, green: 0.62, blue: 0.18)
    static let uiColor = UIColor(red: 1.0, green: 0.62, blue: 0.18, alpha: 0.95)
    static let glowColor = UIColor(red: 1.0, green: 0.45, blue: 0.05, alpha: 0.8)

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "''yy MM dd" // '' 는 작은따옴표 리터럴
        return f
    }()

    static func text(for date: Date) -> String {
        formatter.string(from: date)
    }

    /// 이미지 오른쪽 아래에 스탬프를 구워 넣는다. 크기는 이미지 폭에 비례한다.
    static func draw(on image: UIImage, date: Date) -> UIImage {
        let size = image.size
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)

        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))

            let fontSize = size.width * 0.038
            let shadow = NSShadow()
            shadow.shadowColor = glowColor
            shadow.shadowBlurRadius = fontSize * 0.18
            shadow.shadowOffset = .zero

            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .bold),
                .foregroundColor: uiColor,
                .shadow: shadow,
                .kern: fontSize * 0.08,
            ]
            let string = NSAttributedString(string: text(for: date), attributes: attributes)
            let bounds = string.size()
            let margin = size.width * 0.045
            string.draw(at: CGPoint(x: size.width - bounds.width - margin,
                                    y: size.height - bounds.height - margin))
        }
    }
}

/// 미리보기 위에 얹는 스탬프. 저장본과 같은 색/폰트를 쓴다.
struct DateStampLabel: View {
    var date: Date

    var body: some View {
        Text(DateStamp.text(for: date))
            .font(.system(size: 15, weight: .bold, design: .monospaced))
            .tracking(1.2)
            .foregroundStyle(DateStamp.color)
            .shadow(color: Color(DateStamp.glowColor), radius: 2.5)
    }
}
