// 되팔았을 때 실제로 손에 남는 돈을 계산한다.
// 모든 금액은 마켓 통화(기본 USD) 기준이고, 결과는 센트 단위로 반올림한다.

export interface FeeSettings {
  /** eBay 최종 낙찰 수수료율. 미국 대부분 카테고리 13.6% (판매가+배송비+판매세 기준). */
  finalValueFeeRate: number;
  /** 주문당 고정 수수료. 주문 총액이 기준 이하이면 low, 초과하면 high. */
  perOrderFeeLow: number;
  perOrderFeeHigh: number;
  perOrderFeeThreshold: number;
  /** 구매자가 내는 판매세 평균. eBay 수수료가 세금 포함 금액에 붙기 때문에 필요하다. */
  resaleTaxRate: number;
  /** 프로모티드 리스팅 광고비율 (0 이면 안 씀). */
  promotedRate: number;
  /** 내가 살 때 붙는 판매세 (리셀 증명서가 있으면 0). */
  purchaseTaxRate: number;
  /** 구매자에게 보낼 때 내가 쓰는 배송 라벨 비용. */
  outboundShipping: number;
  /** 박스, 뽁뽁이 등. */
  packaging: number;
  /** 배송비가 '계산형'이라 검색 결과에 안 나올 때 가정할 매입 배송비. */
  unknownShippingEstimate: number;
}

export const DEFAULT_FEES: FeeSettings = {
  finalValueFeeRate: 0.136,
  perOrderFeeLow: 0.3,
  perOrderFeeHigh: 0.4,
  perOrderFeeThreshold: 10,
  resaleTaxRate: 0.07,
  promotedRate: 0,
  purchaseTaxRate: 0.07,
  outboundShipping: 10,
  packaging: 1,
  unknownShippingEstimate: 15,
};

export interface ProfitBreakdown {
  buyPrice: number;
  buyShipping: number;
  purchaseTax: number;
  /** 매입 총비용 */
  cost: number;
  /** 구매자가 낼 금액 (판매가 + 구매자 부담 배송비, 세금 제외) */
  saleTotal: number;
  finalValueFee: number;
  perOrderFee: number;
  promotedFee: number;
  outboundShipping: number;
  packaging: number;
  /** eBay 정산 후 배송·포장까지 빼고 남는 돈 */
  proceeds: number;
  profit: number;
  /** 수익률 (profit / cost) */
  roi: number;
}

export const cents = (n: number) => Math.round(n * 100) / 100;

export function computeProfit(
  input: { buyPrice: number; buyShipping: number; saleTotal: number },
  fees: FeeSettings,
): ProfitBreakdown {
  const { buyPrice, buyShipping, saleTotal } = input;
  const purchaseTax = cents((buyPrice + buyShipping) * fees.purchaseTaxRate);
  const cost = cents(buyPrice + buyShipping + purchaseTax);

  const feeBase = saleTotal * (1 + fees.resaleTaxRate);
  const finalValueFee = cents(feeBase * fees.finalValueFeeRate);
  const perOrderFee = saleTotal > fees.perOrderFeeThreshold ? fees.perOrderFeeHigh : fees.perOrderFeeLow;
  const promotedFee = cents(feeBase * fees.promotedRate);

  const proceeds = cents(
    saleTotal - finalValueFee - perOrderFee - promotedFee - fees.outboundShipping - fees.packaging,
  );
  const profit = cents(proceeds - cost);
  const roi = cost > 0 ? profit / cost : 0;

  return {
    buyPrice,
    buyShipping,
    purchaseTax,
    cost,
    saleTotal: cents(saleTotal),
    finalValueFee,
    perOrderFee,
    promotedFee,
    outboundShipping: fees.outboundShipping,
    packaging: fees.packaging,
    proceeds,
    profit,
    roi,
  };
}

/** 원하는 순이익을 남기려면 얼마 이하로 사야 하는지 (역산). */
export function maxBuyFor(saleTotal: number, targetProfit: number, fees: FeeSettings): number {
  const zero = computeProfit({ buyPrice: 0, buyShipping: 0, saleTotal }, fees);
  return Math.max(0, cents((zero.proceeds - targetProfit) / (1 + fees.purchaseTaxRate)));
}
