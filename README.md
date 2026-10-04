# 디카 (Dica)

2000년대 초반 CCD 디지털 카메라의 색감을 그대로 재현하는 **한 번 결제형** 카메라 앱.
구독 없음, 필터 하나, 날짜 스탬프.

- 타깃: 한국 App Store 유료 차트 1위
- 가격: ₩3,300 (출시 첫 주 ₩1,100)
- 플랫폼: iPhone, iOS 17+

## 룩 (The Look)

"필터 50개"가 아니라 **이 앱에서만 나오는 색감 하나**에 집중한다. `Dica/Look/DigicamKernel.ci.metal` 에 정의되어 있고, 미리보기와 저장본에 같은 커널을 쓴다.

| 단계 | 효과 | 이유 |
|---|---|---|
| 색수차 | R/B 채널을 반경 방향으로 반대로 어긋나게 샘플링 | 싸구려 렌즈의 모서리 번짐 |
| CCD 톤 | 하이라이트는 쉽게 날아가고 섀도는 살짝 떠 있는 S-커브 | 다이내믹 레인지가 좁던 센서 |
| 컬러 캐스트 | 섀도 청록, 하이라이트 따뜻한 노랑 | CCD 특유의 스플릿 톤 |
| 채도 | 15% 상승 | 당시 JPEG 엔진의 과장된 색 |
| 그레인 | 픽셀 단위 노이즈, 어두운 곳에서 더 강함 | 고감도 노이즈 |
| 비네팅 | 모서리 어둡게 | 렌즈 주변부 광량 저하 |
| 날짜 스탬프 | 주황색 `'26 10 04`, 오른쪽 아래 | 디카의 상징 |

미리보기는 화면 픽셀 크기로 먼저 맞춘 뒤 룩을 입혀서 그레인이 또렷하게 보이고, 색수차 오프셋은 해상도에 비례하므로 미리보기와 저장본의 룩이 같다.

## 구조

```
Dica/
├── App/
│   ├── DicaApp.swift          앱 진입점
│   └── CameraScreen.swift     메인 화면 (뷰파인더, 셔터, 플래시, 스탬프 토글)
├── Camera/
│   ├── CameraService.swift    AVCaptureSession, 촬영, 전/후면 전환
│   └── CameraPreviewView.swift  MTKView + CIContext 실시간 미리보기
├── Look/
│   ├── DigicamKernel.ci.metal 룩 커널 (Core Image Metal)
│   ├── DigicamFilter.swift    커널을 감싸는 CIFilter
│   ├── LookRenderer.swift     CIContext 공유, 원본 현상 파이프라인
│   └── DateStamp.swift        날짜 스탬프 (저장용 CoreGraphics + 미리보기용 SwiftUI)
├── Photos/
│   └── PhotoSaver.swift       앨범 저장 (추가 전용 권한)
├── Import/
│   ├── ImportView.swift       앨범 사진에 룩 입히기
│   └── ImageMetadata.swift    EXIF 촬영 일시 읽기
├── UI/
│   ├── ShutterButton.swift
│   └── PhotoReviewView.swift  촬영 결과 보기 + 공유
└── Resources/Assets.xcassets
```

## 실행

Xcode 프로젝트는 [XcodeGen](https://github.com/yonaskolb/XcodeGen) 으로 생성한다. `project.yml` 이 원본이고 `Dica.xcodeproj` 는 커밋하지 않는다.

```bash
brew install xcodegen
xcodegen generate
open Dica.xcodeproj
```

1. Xcode 에서 Signing & Capabilities → Team 을 본인 계정으로 바꾼다.
2. `project.yml` 의 `PRODUCT_BUNDLE_IDENTIFIER` 를 본인 번들 ID 로 바꾸고 `xcodegen generate` 를 다시 돌린다.
3. **실제 iPhone** 에서 실행한다. 시뮬레이터에는 카메라가 없다. (앨범 가져오기는 시뮬레이터에서도 된다.)

Core Image Metal 커널은 `MTL_COMPILER_FLAGS=-fcikernel`, `MTLLINKER_FLAGS=-cikernel` 이 있어야 `default.metallib` 에 들어간다. `project.yml` 에 이미 설정되어 있다.

## 출시 체크리스트

- [ ] 앱 아이콘 (1024×1024) — `Assets.xcassets/AppIcon.appiconset`
- [ ] 룩 튜닝: 실제 사진 50장으로 `LookSettings` 기본값 확정
- [ ] 스크린샷 6장: 설명 없이 결과물 사진만
- [ ] App Store Connect 에서 **사전 주문 2~4주** 설정 (사전 주문은 출시일 하루에 몰아서 집계되므로 차트 스파이크의 핵심)
- [ ] 출시 2주 전부터 릴스/틱톡에 결과물만 업로드
- [ ] 출시 첫 주 반값, 1위 스크린샷을 다시 콘텐츠로
