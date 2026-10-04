// 디카 룩 — 2000년대 초반 CCD 디지털 카메라 느낌을 내는 Core Image Metal 커널.
//
// 룩의 구성 요소 (순서대로 적용):
//   1. 렌즈 색수차: R/B 채널을 중심 기준 반경 방향으로 반대로 어긋나게 샘플링
//   2. CCD 톤: 하이라이트는 쉽게 날아가고, 섀도는 살짝 떠 있는 S-커브
//   3. 컬러 캐스트: 섀도 → 청록, 하이라이트 → 따뜻한 노랑
//   4. 채도 약간 상승
//   5. 픽셀 단위 그레인 (어두운 곳에서 더 강함)
//   6. 비네팅
//
// 빌드 시 MTL_COMPILER_FLAGS=-fcikernel, MTLLINKER_FLAGS=-cikernel 이 필요합니다 (project.yml 참고).

#include <CoreImage/CoreImage.h>
using namespace metal;

static float hash12(float2 p) {
    float3 p3 = fract(float3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

static float luma(float3 c) {
    return dot(c, float3(0.299, 0.587, 0.114));
}

extern "C" {

float4 digicam(coreimage::sampler src,
               float grain,
               float vignette,
               float fringe,
               float seed,
               coreimage::destination dest)
{
    float4 ext = src.extent();
    float2 size = ext.zw;
    float2 p = dest.coord();
    float2 uv = (p - ext.xy) / size;
    float2 centered = uv - 0.5;
    float r2 = dot(centered, centered); // 중앙 0, 모서리 약 0.5

    // 1. 색수차 — 해상도에 비례하는 픽셀 오프셋이라 미리보기와 원본의 룩이 같다
    float2 off = centered * fringe * size.x * 0.0025;
    float3 c;
    c.r = src.sample(src.transform(p + off)).r;
    c.g = src.sample(src.transform(p)).g;
    c.b = src.sample(src.transform(p - off)).b;

    // Core Image 작업 공간은 선형이므로 감마 공간으로 옮겨서 톤을 만진다
    float3 s = pow(max(c, float3(0.0)), float3(1.0 / 2.2));

    // 2. CCD 톤
    s = s * 1.10 - 0.02;
    s = clamp(s, float3(0.0), float3(1.0));
    float3 curve = s * s * (3.0 - 2.0 * s);
    s = mix(s, curve, 0.35);

    // 3. 컬러 캐스트
    float l = luma(s);
    float shadow = (1.0 - l) * (1.0 - l);
    float high = l * l;
    s += shadow * float3(-0.030, 0.010, 0.045);
    s += high   * float3( 0.035, 0.015, -0.030);

    // 4. 채도
    float l2 = luma(s);
    s = mix(float3(l2), s, 1.15);

    // 5. 그레인
    float n = hash12(p + float2(seed * 17.0, seed * 31.0)) - 0.5;
    s += n * grain * (0.5 + 0.8 * (1.0 - l2));

    // 6. 비네팅
    s *= 1.0 - vignette * smoothstep(0.08, 0.55, r2);

    s = clamp(s, float3(0.0), float3(1.0));
    return float4(pow(s, float3(2.2)), 1.0);
}

}
