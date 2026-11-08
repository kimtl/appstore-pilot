import Link from "next/link";
import { getScan, listHunts, listInventory } from "@/lib/data";
import { isConfigured } from "@/lib/ebay/config";
import { ago, money } from "@/lib/format";
import { DealCard } from "@/components/DealCard";
import { ActionForm, Submit } from "@/components/ActionForm";
import { scanAllAction } from "../actions";

export default async function DealsPage() {
  if (!isConfigured()) {
    return (
      <section className="empty">
        <h2>eBay 개발자 키가 필요해요</h2>
        <p>
          <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code> 환경변수를 넣어 주세요. 방법은 README 에 있어요.
        </p>
      </section>
    );
  }

  const hunts = await listHunts();
  if (!hunts.length) {
    return (
      <section className="empty">
        <h2>무엇을 찾을까요?</h2>
        <p>되팔 물건의 검색어를 사냥 목록에 넣으면, 시세보다 싸게 올라온 매물을 찾아드려요.</p>
        <Link className="btn primary" href="/hunts">
          사냥 목록 만들기
        </Link>
      </section>
    );
  }

  const scans = await Promise.all(hunts.map(async (h) => ({ hunt: h, scan: await getScan(h.id) })));
  const owned = new Set((await listInventory()).map((i) => i.sourceItemId));
  const deals = scans
    .flatMap((s) => s.scan?.deals ?? [])
    .filter((d) => !owned.has(d.listing.itemId))
    .sort((a, b) => b.score - a.score);
  const shown = deals.filter((d) => d.review?.verdict !== "skip");
  const skipped = deals.filter((d) => d.review?.verdict === "skip");
  const reviewErrors = scans.map((s) => s.scan?.reviewError).filter(Boolean);
  const lastScan = scans.map((s) => s.scan?.scannedAt).filter(Boolean).sort().pop();

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>딜 {shown.length}개</h1>
          <p className="hint">{lastScan ? `마지막 스캔 ${ago(lastScan)}` : "아직 스캔하지 않았어요"}</p>
        </div>
        <ActionForm action={scanAllAction}>
          <Submit pending="eBay 뒤지는 중…">전체 스캔</Submit>
        </ActionForm>
      </div>

      <div className="chips">
        {scans.map(({ hunt, scan }) => (
          <span key={hunt.id} className="chip">
            {hunt.query} · {scan ? `${scan.deals.length}개 · 시세 ${money(scan.estimate?.median)}` : "미스캔"}
          </span>
        ))}
      </div>

      {reviewErrors.length > 0 && <p className="msg error">Claude 검토 실패: {reviewErrors[0]}</p>}

      <div className="list">
        {shown.map((d) => (
          <DealCard key={`${d.huntId}-${d.listing.itemId}`} deal={d} />
        ))}
      </div>
      {skipped.length > 0 && (
        <details>
          <summary>Claude 가 거른 딜 {skipped.length}개</summary>
          <div className="list">
            {skipped.map((d) => (
              <DealCard key={`${d.huntId}-${d.listing.itemId}`} deal={d} />
            ))}
          </div>
        </details>
      )}
      {lastScan && !shown.length && <p className="empty">조건에 맞는 매물이 없어요. 최소 이익·수익률을 낮추거나 검색어를 넓혀 보세요.</p>}
    </>
  );
}
