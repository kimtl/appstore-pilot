# Flip

eBay 에서 **시세보다 싸게 올라온 매물을 찾아 사고, 다시 eBay 에 올려 파는** 개인용 웹앱. 나 혼자 쓰는 도구라 계정은 비밀번호 하나뿐이다.

```
사냥 목록 ──스캔──▶ 딜 ──eBay 에서 구매──▶ 재고 ──사진·초안──▶ 등록 ──판매 확인──▶ 이익
```

## 흐름

1. **사냥 목록**: 되팔 물건 검색어(`nintendo switch oled -lite`), 상태(중고/새것/부품용), 최소 순이익·수익률, 매입 상한.
2. **스캔**: 사냥 하나에 eBay 검색 3번.
   - 기본 정렬 200건 → 시세 계산용 비교 매물
   - 싼 순 100건 + 새로 올라온 순 100건 → 구매 후보
   - 제목이 다른 물건, 고장·부품용·박스만, 상태가 다른 것, 경매는 걸러낸다.
3. **딜**: 후보마다 "빨리 팔리는 가격"에 되팔았을 때 수수료·세금·배송비를 다 빼고 남는 돈을 계산해서, 기준을 넘는 것만 이익 순으로 보여준다. 너무 싸거나(시세 40% 미만), 판매자 평점이 낮거나, 해외 발송이면 경고를 달고 순위를 내린다.
4. **구매**: "eBay 에서 사기"로 eBay 결제 페이지에서 직접 산다. 산 뒤 "샀어요"를 누르면 재고로 들어가고, 원래 매물의 제목·카테고리·스펙으로 등록 초안이 만들어진다.
5. **등록**: 물건이 도착하면 직접 사진을 찍어 올리고(브라우저에서 1600px 로 줄여서 eBay 이미지 서버로 업로드) "지금 등록". Inventory API 로 인벤토리 아이템 → 오퍼 → 게시.
6. **판매 확인**: Fulfillment API 로 최근 주문을 가져와 내 리스팅과 맞으면 "팔림"으로 옮기고 실제 판매액으로 이익을 낸다.

### 시세는 어떻게 정하나

| | 판매완료 (Marketplace Insights) | 판매중 (Browse) |
|---|---|---|
| 쓸 수 있나 | eBay 승인 필요 (`EBAY_USE_INSIGHTS=1`) | 누구나 |
| 되팔기 가격 | 극단값 제거 후 40% 지점 | 극단값 제거 후 **30% 지점** |
| 신뢰도 최대 | high | medium |

판매중 매물은 비싸게 걸어놓고 안 팔리는 것들이 남아 있어서 위로 치우친다. 그래서 아래쪽 30% 가격, 즉 "지금 경쟁 매물들 사이에서 금방 팔릴 가격"으로 잡는다.

### 이익 계산 (`src/lib/fees.ts`, 설정에서 변경 가능)

```
판매수수료 = (판매가+배송비) × (1 + 구매자 판매세 7%) × 13.6%
정산액    = 판매가 − 판매수수료 − 주문당 $0.40 − 라벨비 $10 − 포장 $1
원가      = 매입가 + 매입 배송비 + 매입 판매세 7%
순이익    = 정산액 − 원가
```

## 직접 해야 하는 것 / 일부러 안 한 것

- **자동 구매는 안 한다.** eBay 의 주문 API(Buy Order)는 승인된 파트너만 쓸 수 있고, 돈이 나가는 일이라 마지막 클릭은 사람이 하는 게 맞다.
- **남의 사진·설명은 가져오지 않는다.** 저작권이 원래 판매자에게 있고 eBay 정책 위반이다. 스펙(브랜드, 모델 등)만 가져온다.
- 등록 전에 eBay 판매자 허브에서 **비즈니스 정책**(배송·결제·반품)을 만들어 둬야 한다.
- 실제 산 가격·배송비·세금, 실제 라벨비는 재고 화면에서 고쳐 넣으면 이익이 정확해진다.

## 설정

### 1. eBay 개발자 키

1. <https://developer.ebay.com> 가입 → **Application Keys** 에서 Production(또는 Sandbox) 키셋 생성.
2. 실서비스 키를 켜려면 **Marketplace account deletion** 알림을 설정해야 한다.
   - Endpoint: `https://<배포주소>/api/ebay/account-deletion`
   - Verification token: 32~80자 아무 문자열 → `EBAY_VERIFICATION_TOKEN` 에도 같은 값
3. **User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL** 로 RuName 생성.
   - Auth accepted URL: `https://<배포주소>/api/oauth/callback`
   - 생성된 RuName 문자열을 `EBAY_RUNAME` 에.
   - 로컬에서만 쓸 거면 accepted URL 을 eBay 기본값으로 두고, 로그인 후 뜨는 페이지 주소를 설정 화면에 붙여넣으면 된다.

### 2. 로컬 실행

```bash
cd flip
cp .env.example .env.local   # 값 채우기
npm install
npm run dev                  # http://localhost:3000
```

로컬에서는 데이터가 `flip/data/*.json` 에 저장된다 (git 에는 안 올라감).

### 3. Vercel 배포 (폰에서도 쓰기)

1. Vercel 에서 이 레포를 import, **Root Directory = `flip`**.
2. Storage → **Upstash Redis** 연결 (`KV_REST_API_URL`, `KV_REST_API_TOKEN` 자동 설정).
3. 환경변수: `APP_PASSWORD`, `EBAY_*`, `PUBLIC_BASE_URL`, `EBAY_VERIFICATION_TOKEN`, `CRON_SECRET`.
4. `vercel.json` 의 크론이 매일 한 번(UTC 13:17 = 한국 22:17) 모든 사냥을 스캔한다.

## 개발

```bash
npm test          # 수수료·시세·딜 판정·등록 초안 단위 테스트
npm run typecheck
npm run build
```

| 파일 | 역할 |
|---|---|
| `src/lib/fees.ts` | 수수료·순이익 계산, 목표 이익 역산 |
| `src/lib/comps.ts` | 제목 매칭, 정크 판별, 시세 추정 |
| `src/lib/deals.ts` | 후보 → 딜 판정, 경고, 점수 |
| `src/lib/scan.ts` | 사냥 실행 (검색 3번 + 판매완료) |
| `src/lib/listing.ts` | 등록 초안, 상태 코드 변환, 주문 매칭 |
| `src/lib/publish.ts` | 등록·가격 변경·판매 확인 |
| `src/lib/ebay/*` | OAuth, Browse, Sell(Inventory·Account·Fulfillment·Media) API |
| `src/lib/store.ts` | Upstash Redis 또는 로컬 JSON |
| `src/app/actions.ts` | 화면에서 부르는 서버 액션 |
