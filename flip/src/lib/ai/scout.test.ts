import { describe, expect, it } from "vitest";
import { applyPlan, buildBriefing, PlanSchema, type Plan } from "./scout";
import { DEFAULT_AI, type InventoryItem, type Settings } from "../data";
import { DEFAULT_FEES } from "../fees";
import type { Hunt } from "../deals";

const settings: Settings = { fees: DEFAULT_FEES, ai: { ...DEFAULT_AI, maxHunts: 2, maxBuyPerItem: 200 } };
const H = (id: string, query: string, source: "me" | "claude"): Hunt => ({
  id, query, source, condition: "used", minProfit: 20, minRoi: 0.25, excludes: [], createdAt: "2026-11-01",
});
const empty: Plan = { summary: "", add: [], update: [], retire: [], notes: "" };
const add = (query: string, extra: Partial<Plan["add"][number]> = {}) => ({
  query, condition: "used" as const, minProfit: 25, minRoiPercent: 30, excludes: [], reason: "r", ...extra,
});

describe("applyPlan", () => {
  const hunts = [H("me1", "sony wh-1000xm4", "me"), H("c1", "nintendo switch oled", "claude")];

  it("Claude 는 내 사냥을 중단하거나 고칠 수 없다", () => {
    const r = applyPlan(hunts, { ...empty, retire: [{ huntId: "me1", reason: "x" }], update: [{ huntId: "me1", minProfit: 1, reason: "x" }] }, settings);
    expect(r.hunts.find((h) => h.id === "me1")).toEqual(hunts[0]);
    expect(r.changes).toEqual([]);
  });

  it("Claude 사냥은 중단·조정할 수 있고, 매입 상한은 주인 한도로 잘린다", () => {
    const r = applyPlan(hunts, { ...empty, update: [{ huntId: "c1", maxBuy: 999, minRoiPercent: 40, reason: "y" }] }, settings);
    const c1 = r.hunts.find((h) => h.id === "c1")!;
    expect(c1.maxBuy).toBe(200);
    expect(c1.minRoi).toBe(0.4);
    expect(applyPlan(hunts, { ...empty, retire: [{ huntId: "c1", reason: "z" }] }, settings).hunts.map((h) => h.id)).toEqual(["me1"]);
  });

  it("슬롯 수를 넘겨 추가하지 않고, 중복 검색어는 무시한다", () => {
    const r = applyPlan(hunts, { ...empty, add: [add("Nintendo  Switch OLED"), add("airpods pro 2", { maxBuy: 500 }), add("steam deck 512gb")] }, settings);
    const claude = r.hunts.filter((h) => h.source === "claude");
    expect(claude.map((h) => h.query)).toEqual(["nintendo switch oled", "airpods pro 2"]);
    expect(claude[1].maxBuy).toBe(200);
    expect(claude[1].minRoi).toBe(0.3);
    expect(r.changes.some((c) => c.startsWith("건너뜀") && c.includes("steam deck"))).toBe(true);
  });

  it("중단한 만큼 슬롯이 다시 생긴다", () => {
    const r = applyPlan(hunts, { ...empty, retire: [{ huntId: "c1", reason: "z" }], add: [add("airpods pro 2"), add("steam deck 512gb")] }, settings);
    expect(r.hunts.filter((h) => h.source === "claude")).toHaveLength(2);
  });
});

describe("buildBriefing", () => {
  it("사냥별 매매 성적을 묶어준다", () => {
    const sold: InventoryItem = {
      id: "i1", status: "sold", title: "Switch", sourceItemId: "s", currency: "USD", boughtAt: "2026-10-01",
      buyPrice: 150, buyShipping: 0, buyTax: 10.5, saleTotal: 255, actualShipping: 10,
      huntId: "c1", huntQuery: "nintendo switch oled", listedAt: "2026-10-05T00:00:00Z", soldAt: "2026-10-09T00:00:00Z",
    };
    const b = buildBriefing({
      hunts: [H("c1", "nintendo switch oled", "claude")],
      scans: [undefined],
      inventory: [sold],
      settings,
      marketplace: { id: "EBAY_US", currency: "USD", country: "US" },
      today: "2026-11-08",
    });
    expect(b.hunts[0].record).toEqual({ bought: 1, sold: 1, realizedProfit: 45.99, avgDaysToSell: 4, stillHolding: 0 });
    expect(b.owner.claudeHuntSlots).toEqual({ used: 1, max: 2 });
    expect(b.notesFromLastRun).toBe("(첫 정찰)");
  });
});

describe("PlanSchema", () => {
  it("빈 계획도 유효하다", () => {
    expect(PlanSchema.parse(empty)).toEqual(empty);
  });
});
