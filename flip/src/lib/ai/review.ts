// 스캔으로 걸러진 딜을 Claude 가 한 번 더 본다.
// 숫자 필터가 못 잡는 것들: "충전기 없음", "UK 플러그", "화면 번인", 본체가 아닌 액세서리,
// 시세 대비 너무 싸서 사기 같은 매물, 상태 설명과 가격이 안 맞는 매물 등.
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Deal, DealReview, Hunt } from "../deals";
import { getItem, type Item } from "../ebay/browse";
import { assertNotRefused, claude, FALLBACK, MODEL } from "./claude";

/** 사냥 하나당 Claude 가 볼 딜 수 (getItem 호출 수와 같음) */
export const REVIEW_LIMIT = 8;

const ReviewSchema = z.object({
  reviews: z.array(
    z.object({
      itemId: z.string(),
      verdict: z.enum(["buy", "check", "skip"]),
      reason: z.string().describe("한국어 한 문장. 사라는 이유 또는 걸리는 점"),
    }),
  ),
});

const SYSTEM = `당신은 eBay 리셀러의 매입 검토자입니다. 앱이 "시세보다 싸다"고 고른 매물을 사기 전에 한 번 더 봅니다.
각 매물에 판정을 내리세요:
- buy: 설명과 사진 정보상 문제 없고, 계산된 이익이 현실적이다. 바로 사도 된다.
- check: 살 만하지만 사람이 확인할 게 있다 (판매자에게 물어볼 것, 사진 확인 필요 등). 무엇을 확인할지 적으세요.
- skip: 사지 말 것. 본체가 아님(액세서리/부품/박스), 빠진 구성품으로 시세가 안 맞음, 잠금·고장·하자, 다른 모델, 지역 규격 문제, 사기 의심(신규 판매자+비정상적으로 싼 가격 등), 비교 시세가 이 매물과 안 맞음.
제목뿐 아니라 상태 설명, 짧은 설명, 스펙을 읽으세요. 숫자(이익·시세)는 앱이 계산한 것을 그대로 믿되, 그 시세가 이 매물에 적용되는지를 판단하세요.
모든 매물에 대해 정확히 하나씩 판정하세요.`;

function brief(deal: Deal, item?: Item) {
  const l = deal.listing;
  return {
    itemId: l.itemId,
    title: l.title,
    condition: l.condition,
    conditionDescription: item?.conditionDescription,
    shortDescription: item?.shortDescription?.slice(0, 800),
    aspects: item?.localizedAspects?.slice(0, 25).map((a) => `${a.name}: ${a.value}`),
    photos: 1 + (item?.additionalImages?.length ?? 0),
    price: l.price,
    shipping: l.shipping ?? "unknown",
    seller: { name: l.sellerName, feedbackPercent: l.sellerFeedbackPercent, feedbackScore: l.sellerFeedbackScore },
    shipsFrom: l.country,
    market: { median: deal.estimate.median, resaleAt: deal.estimate.quickSale, range: [deal.estimate.low, deal.estimate.high], comps: deal.estimate.sampleSize, source: deal.estimate.source },
    expectedProfit: deal.breakdown.profit,
    roiPercent: Math.round(deal.breakdown.roi * 100),
    appWarnings: deal.warnings,
  };
}

/**
 * 딜에 Claude 판정을 붙인다. 지난 스캔에서 같은 가격으로 이미 본 매물은 다시 보지 않는다.
 * 실패해도 스캔 자체는 살린다 (판정 없이 돌려줌).
 */
export async function reviewDeals(hunt: Hunt, deals: Deal[], previous: Map<string, DealReview>): Promise<{ deals: Deal[]; error?: string }> {
  const withOld = deals.map((d) => {
    const old = previous.get(d.listing.itemId);
    return old && old.price === d.listing.price ? { ...d, review: old } : d;
  });
  const todo = withOld.filter((d) => !d.review).slice(0, REVIEW_LIMIT);
  if (!todo.length) return { deals: withOld };

  try {
    const items = await Promise.all(todo.map((d) => getItem(d.listing.itemId).catch(() => undefined)));
    const res = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(ReviewSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `사냥: "${hunt.query}" (${hunt.condition})\n\n매물:\n${JSON.stringify(
            todo.map((d, i) => brief(d, items[i])),
            null,
            2,
          )}`,
        },
      ],
      ...FALLBACK,
    });
    assertNotRefused(res);
    const now = new Date().toISOString();
    const verdicts = new Map((res.parsed_output?.reviews ?? []).map((r) => [r.itemId, r]));
    return {
      deals: withOld.map((d) => {
        const r = verdicts.get(d.listing.itemId);
        return r ? { ...d, review: { verdict: r.verdict, reason: r.reason, price: d.listing.price, reviewedAt: now } } : d;
      }),
    };
  } catch (e) {
    return { deals: withOld, error: (e as Error).message };
  }
}

/** Claude 판정을 반영한 정렬: buy 먼저, skip 은 맨 뒤. */
export function rankReviewed(deals: Deal[]): Deal[] {
  const weight = (d: Deal) => (d.review?.verdict === "buy" ? 1.3 : d.review?.verdict === "skip" ? 0 : 1);
  return [...deals].sort((a, b) => b.score * weight(b) - a.score * weight(a));
}
