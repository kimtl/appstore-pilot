// Claude 정찰병: 무엇을 사냥할지 Claude 가 정한다.
//
// 1. 지금 사냥 목록·최근 스캔 결과·내 매매 성적·지난번 메모를 브리핑으로 받는다.
// 2. probe_market 으로 후보 물건의 eBay 시세를 직접 확인한다 (감으로 정하지 않게).
// 3. submit_plan 으로 사냥 추가/조정/중단과 다음번에 볼 메모를 낸다.
// Claude 는 자기가 만든 사냥만 고치거나 끌 수 있고, 내가 만든 사냥은 건드리지 않는다.
import { randomUUID } from "node:crypto";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { kv } from "../store";
import { getScan, getSettings, itemCost, listHunts, listInventory, type InventoryItem, type Settings } from "../data";
import type { Hunt, ScanResult } from "../deals";
import { ebayConfig } from "../ebay/config";
import { itemProfit } from "../pnl";
import { probeMarket } from "../scan";
import { assertNotRefused, claude, FALLBACK, MODEL } from "./claude";

const MAX_PROBES = 20;

const condition = z.enum(["new", "used", "parts"]);

export const PlanSchema = z.object({
  summary: z.string().describe("이번에 무엇을 왜 바꿨는지 한국어 2~4문장"),
  add: z
    .array(
      z.object({
        query: z.string().describe("eBay 검색어 (영어). 모델명·용량까지 구체적으로. 제외어는 -word"),
        condition,
        minProfit: z.number().describe("최소 순이익 (마켓 통화)"),
        minRoiPercent: z.number().describe("최소 수익률 %, 예: 25"),
        maxBuy: z.number().optional().describe("매입 총액 상한"),
        excludes: z.array(z.string()).describe("제목에 있으면 제외할 단어"),
        categoryId: z.string().optional(),
        reason: z.string().describe("이 물건을 고른 이유와 probe 결과 근거, 한국어 한두 문장"),
      }),
    )
    .describe("새로 시작할 사냥"),
  update: z
    .array(
      z.object({
        huntId: z.string(),
        minProfit: z.number().optional(),
        minRoiPercent: z.number().optional(),
        maxBuy: z.number().optional(),
        excludes: z.array(z.string()).optional(),
        reason: z.string(),
      }),
    )
    .describe("기준을 바꿀 기존 Claude 사냥"),
  retire: z.array(z.object({ huntId: z.string(), reason: z.string() })).describe("그만둘 Claude 사냥"),
  notes: z.string().describe("다음 정찰 때 나에게 남기는 메모: 배운 점, 다음에 확인할 후보, 피할 것. 1500자 이내"),
});

export type Plan = z.infer<typeof PlanSchema>;

export interface ScoutRun {
  at: string;
  summary: string;
  changes: string[];
  probes: number;
  error?: string;
}

// ── 브리핑 ───────────────────────────────────────

function huntStats(hunt: Hunt, scan: ScanResult | undefined, items: InventoryItem[], settings: Settings) {
  const mine = items.filter((i) => i.huntId === hunt.id);
  const sold = mine.filter((i) => i.status === "sold");
  const days = sold
    .filter((i) => i.listedAt && i.soldAt)
    .map((i) => (new Date(i.soldAt!).getTime() - new Date(i.listedAt!).getTime()) / 86400_000);
  return {
    id: hunt.id,
    by: hunt.source ?? "me",
    query: hunt.query,
    condition: hunt.condition,
    minProfit: hunt.minProfit,
    minRoiPercent: Math.round(hunt.minRoi * 100),
    maxBuy: hunt.maxBuy,
    excludes: hunt.excludes,
    reason: hunt.reason,
    createdAt: hunt.createdAt.slice(0, 10),
    lastScan: scan && {
      at: scan.scannedAt.slice(0, 16),
      deals: scan.deals.length,
      claudeBuy: scan.deals.filter((d) => d.review?.verdict === "buy").length,
      claudeSkip: scan.deals.filter((d) => d.review?.verdict === "skip").length,
      candidates: scan.candidateCount,
      comps: scan.compCount,
      median: scan.estimate?.median,
      quickSale: scan.estimate?.quickSale,
      confidence: scan.estimate?.confidence,
      rejected: scan.rejected,
    },
    record: {
      bought: mine.length,
      sold: sold.length,
      realizedProfit: Math.round(sold.reduce((s, i) => s + itemProfit(i, settings.fees).profit, 0) * 100) / 100,
      avgDaysToSell: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : undefined,
      stillHolding: mine.filter((i) => i.status === "bought" || i.status === "listed").length,
    },
  };
}

export function buildBriefing(input: {
  hunts: Hunt[];
  scans: (ScanResult | undefined)[];
  inventory: InventoryItem[];
  settings: Settings;
  notes?: string;
  marketplace: { id: string; currency: string; country: string };
  today: string;
}) {
  const { hunts, scans, inventory, settings } = input;
  const open = inventory.filter((i) => i.status === "bought" || i.status === "listed");
  const claudeHunts = hunts.filter((h) => h.source === "claude").length;
  return {
    today: input.today,
    marketplace: input.marketplace,
    owner: {
      guidance: settings.ai.guidance || "(없음)",
      maxBuyPerItem: settings.ai.maxBuyPerItem,
      claudeHuntSlots: { used: claudeHunts, max: settings.ai.maxHunts },
      capitalTiedUp: Math.round(open.reduce((s, i) => s + itemCost(i), 0) * 100) / 100,
      openItems: open.length,
    },
    fees: settings.fees,
    hunts: hunts.map((h, i) => huntStats(h, input.scans[i], inventory, settings)),
    recentlySold: inventory
      .filter((i) => i.status === "sold")
      .slice(0, 15)
      .map((i) => ({ title: i.title, hunt: i.huntQuery, cost: itemCost(i), saleTotal: i.saleTotal, profit: itemProfit(i, settings.fees).profit })),
    notesFromLastRun: input.notes || "(첫 정찰)",
  };
}

export const SYSTEM = `당신은 eBay 리셀러의 정찰병입니다. 주인은 혼자서 eBay 에서 싸게 사서 eBay 에 되팔아 돈을 법니다.
당신의 일은 "무엇을 사냥할지"를 정하는 것입니다. 사냥 = 앱이 매일 eBay 를 검색해서 시세보다 싸게 올라온 매물을 찾는 검색어 + 기준.

목표: 묶인 돈과 시간 대비 실제로 남는 돈을 최대화.

좋은 사냥감:
- 모델명으로 정확히 특정되는 물건 (예: "sony wh-1000xm4", "nintendo switch oled"). 시세가 또렷해야 싸게 올라온 걸 알아볼 수 있다.
- 거래량이 많아 빨리 팔리는 물건 (비교 매물 수십 개 이상).
- 가격대가 적당해서 수수료를 내고도 $20 이상 남는 물건. 너무 싼 물건은 수수료·배송비에 먹힌다.
- 작고 가벼워 배송비가 싸고 파손 위험이 낮은 물건.
- 판매자들이 가치를 잘 모르고 싸게 올리는 경향이 있는 물건 (번들, 오래된 세대지만 수요 있는 것, 제목을 대충 쓴 것).

피할 것:
- 가품이 많은 물건 (명품 가방, 고가 스니커즈, 시계), 정품 인증이 필요한 카테고리, VeRO 단속이 심한 브랜드.
- 활성화 잠금·통신사 잠금 위험이 큰 물건은 기준을 보수적으로.
- 크고 무거운 물건, 유리·액정 파손 위험이 큰 물건.
- eBay 판매 제한 품목 (의약품, 무기류, 리콜 제품 등).
- 주인 지침에 어긋나는 것.

일하는 방식:
1. 브리핑을 보고 기존 사냥의 성적을 판단하세요. 딜이 계속 0개이거나, 비교 매물이 적어 신뢰도가 낮거나, 사서 안 팔리는 사냥은 기준을 고치거나 그만두세요. 잘 되는 사냥은 비슷한 물건으로 넓히세요.
2. 새 후보는 반드시 probe_market 으로 확인한 뒤에만 추가하세요. comparableListings 가 충분하고(대략 20개 이상), maxBuyForTargetProfit 가 주인의 maxBuyPerItem 이하이고, listingsUnderMaxBuyNow 가 가끔이라도 나올 만한지 봅니다. 숫자가 나쁘면 버리세요.
3. 검색어는 영어로, 다른 모델이 섞이지 않게 구체적으로 쓰고 필요하면 -word 로 제외어를 넣으세요. probe 결과의 sampleTitles 를 보고 엉뚱한 물건이 섞이는지 확인하세요.
4. 주인이 만든 사냥(by: "me")은 바꾸거나 끌 수 없습니다. 의견이 있으면 summary 에 적으세요.
5. Claude 사냥 슬롯(claudeHuntSlots.max)을 넘지 마세요. 많이 만드는 것보다 확실한 몇 개가 낫습니다.
6. 마지막에 submit_plan 을 정확히 한 번 호출하세요. 바꿀 게 없으면 빈 배열로 제출하고 그 이유를 summary 에 쓰세요.
probe_market 은 한 번 정찰에 ${MAX_PROBES}번까지 쓸 수 있습니다.`;

// ── 계획 적용 ────────────────────────────────────

export function applyPlan(hunts: Hunt[], plan: Plan, settings: Settings, now = new Date().toISOString()) {
  const changes: string[] = [];
  const isClaude = (id: string) => hunts.find((h) => h.id === id)?.source === "claude";
  const retire = new Set(plan.retire.filter((r) => isClaude(r.huntId)).map((r) => r.huntId));
  let next = hunts.filter((h) => {
    if (!retire.has(h.id)) return true;
    changes.push(`중단: ${h.query} — ${plan.retire.find((r) => r.huntId === h.id)!.reason}`);
    return false;
  });

  for (const u of plan.update) {
    const h = next.find((x) => x.id === u.huntId);
    if (!h || h.source !== "claude") continue;
    const patched: Hunt = {
      ...h,
      minProfit: u.minProfit ?? h.minProfit,
      minRoi: u.minRoiPercent !== undefined ? u.minRoiPercent / 100 : h.minRoi,
      maxBuy: u.maxBuy !== undefined ? Math.min(u.maxBuy, settings.ai.maxBuyPerItem) : h.maxBuy,
      excludes: u.excludes ?? h.excludes,
      reason: u.reason,
    };
    next = next.map((x) => (x.id === h.id ? patched : x));
    changes.push(`조정: ${h.query} — ${u.reason}`);
  }

  const norm = (q: string) => q.toLowerCase().replace(/\s+/g, " ").trim();
  for (const a of plan.add) {
    if (next.filter((h) => h.source === "claude").length >= settings.ai.maxHunts) {
      changes.push(`건너뜀 (슬롯 가득): ${a.query}`);
      continue;
    }
    if (next.some((h) => norm(h.query) === norm(a.query) && h.condition === a.condition)) continue;
    next.push({
      id: randomUUID(),
      query: a.query.trim(),
      condition: a.condition,
      categoryId: a.categoryId || undefined,
      maxBuy: Math.min(a.maxBuy ?? settings.ai.maxBuyPerItem, settings.ai.maxBuyPerItem),
      minProfit: Math.max(a.minProfit, 5),
      minRoi: Math.max(a.minRoiPercent, 5) / 100,
      excludes: a.excludes,
      createdAt: now,
      source: "claude",
      reason: a.reason,
    });
    changes.push(`추가: ${a.query} — ${a.reason}`);
  }
  return { hunts: next, changes };
}

// ── 실행 ─────────────────────────────────────────

export async function listScoutRuns() {
  return (await kv().get<ScoutRun[]>("scout-runs")) ?? [];
}

async function logRun(run: ScoutRun) {
  await kv().set("scout-runs", [run, ...(await listScoutRuns())].slice(0, 20));
}

export async function runScout(): Promise<ScoutRun> {
  const [hunts, inventory, settings, notes] = await Promise.all([listHunts(), listInventory(), getSettings(), kv().get<string>("scout-notes")]);
  const scans = await Promise.all(hunts.map((h) => getScan(h.id)));
  const cfg = ebayConfig();
  const briefing = buildBriefing({
    hunts,
    scans,
    inventory,
    settings,
    notes,
    marketplace: { id: cfg.marketplace.id, currency: cfg.marketplace.currency, country: cfg.marketplace.country },
    today: new Date().toISOString().slice(0, 10),
  });

  let probes = 0;
  let plan: Plan | undefined;

  const probeTool = betaZodTool({
    name: "probe_market",
    description:
      "eBay 에서 검색어 하나의 현재 시세를 확인한다. 사냥과 같은 필터(제목 매칭, 고장/부품 제외, 상태 묶음)를 적용한 비교 매물 수, 시세 추정, 목표 이익을 남기려면 얼마 이하로 사야 하는지, 지금 그 가격 이하 매물 수, 샘플 제목을 돌려준다.",
    inputSchema: z.object({
      query: z.string().describe("eBay 검색어 (영어)"),
      condition,
      targetProfit: z.number().optional().describe("목표 순이익, 기본 25"),
    }),
    run: async ({ query, condition: c, targetProfit }) => {
      if (probes >= MAX_PROBES) return `probe 한도(${MAX_PROBES}회)를 다 썼습니다. 지금까지 본 것으로 submit_plan 하세요.`;
      probes++;
      try {
        return JSON.stringify(await probeMarket(query, c, targetProfit ?? 25));
      } catch (e) {
        return `eBay 검색 실패: ${(e as Error).message}`;
      }
    },
  });

  const submitTool = betaZodTool({
    name: "submit_plan",
    description: "정찰 결과를 제출한다. 마지막에 정확히 한 번 호출.",
    inputSchema: PlanSchema,
    run: async (input) => {
      plan = input;
      return "제출 완료. 더 할 일 없음.";
    },
  });

  try {
    const final = await claude().beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      max_iterations: MAX_PROBES + 6,
      // 짧은 루프라 메시지 스레드의 이득이 작다. 매 요청에 전체 대화를 보내는 단순한 쪽을 택한다.
      thread: false,
      output_config: { effort: "high" },
      system: SYSTEM,
      tools: [probeTool, submitTool],
      messages: [{ role: "user", content: `브리핑입니다.\n\n${JSON.stringify(briefing, null, 2)}` }],
      ...FALLBACK,
    });
    assertNotRefused(final);
    if (!plan) throw new Error(`Claude 가 계획을 제출하지 않았어요 (stop_reason: ${final.stop_reason}).`);

    // 슬롯·예산 같은 규칙은 Claude 를 믿지 않고 여기서 강제한다.
    const { hunts: next, changes } = applyPlan(await listHunts(), plan, settings);
    await kv().set("hunts", next);
    const kept = new Set(next.map((h) => h.id));
    await Promise.all(hunts.filter((h) => !kept.has(h.id)).map((h) => kv().del(`scan-${h.id}`)));
    await kv().set("scout-notes", plan.notes.slice(0, 3000));
    const run: ScoutRun = { at: new Date().toISOString(), summary: plan.summary, changes, probes };
    await logRun(run);
    return run;
  } catch (e) {
    const run: ScoutRun = { at: new Date().toISOString(), summary: "", changes: [], probes, error: (e as Error).message };
    await logRun(run);
    throw e;
  }
}
