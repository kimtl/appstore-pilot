import { describe, expect, it } from "vitest";
import { conditionGroup, estimateMarket, normalizeTitle, percentile, TitleMatcher } from "./comps";

describe("TitleMatcher", () => {
  const m = new TitleMatcher("iPhone 13 Pro 128GB -mini");

  it("단어 순서·대소문자·용량 띄어쓰기에 상관없이 맞춘다", () => {
    expect(m.matches("Apple iPhone 13 Pro - 128 GB - Graphite (Unlocked)")).toBe(true);
    expect(m.matches("APPLE IPHONE13 PRO 128GB")).toBe(true);
  });

  it("다른 모델이나 제외어가 있으면 버린다", () => {
    expect(m.matches("Apple iPhone 13 128GB Blue")).toBe(false);
    expect(m.matches("iPhone 13 Pro mini 128GB")).toBe(false);
    expect(m.matches("iPhone 13 Pro 1128GB")).toBe(false);
  });

  it("고장·박스만 같은 매물을 잡아낸다", () => {
    expect(m.junkHit("iPhone 13 Pro 128GB FOR PARTS cracked")).toBe("for parts");
    expect(m.junkHit("iPhone 13 Pro 128GB box only")).toBe("box only");
    expect(m.junkHit("iPhone 13 Pro 128GB excellent")).toBeUndefined();
  });

  it("검색어에 직접 넣은 정크 단어는 문제 삼지 않는다", () => {
    expect(new TitleMatcher("iphone 13 for parts").junkHit("iPhone 13 for parts")).toBeUndefined();
  });

  it("normalizeTitle", () => {
    expect(normalizeTitle("Sony WH-1000XM4  (Black) 32 GB")).toBe("sony wh 1000xm4 black 32gb");
  });
});

describe("conditionGroup", () => {
  it("묶음", () => {
    expect(conditionGroup("1000")).toBe("new");
    expect(conditionGroup("3000")).toBe("used");
    expect(conditionGroup("7000")).toBe("parts");
    expect(conditionGroup(undefined)).toBe("used");
  });
});

describe("estimateMarket", () => {
  it("percentile 은 선형 보간", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it("극단값을 걸러내고 아래쪽 30% 를 빨리 팔리는 가격으로 본다", () => {
    const totals = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 900, 5];
    const e = estimateMarket(totals, "active")!;
    expect(e.sampleSize).toBe(10);
    expect(e.median).toBe(109);
    expect(e.quickSale).toBeCloseTo(105.4, 1);
    expect(e.confidence).toBe("medium"); // active 는 high 를 주지 않는다
  });

  it("판매완료 데이터가 촘촘하면 high", () => {
    const e = estimateMarket([100, 101, 102, 103, 104, 105, 106, 107, 108, 109], "sold")!;
    expect(e.confidence).toBe("high");
  });

  it("3개 미만이면 추정하지 않는다", () => {
    expect(estimateMarket([100, 200], "active")).toBeUndefined();
  });
});
