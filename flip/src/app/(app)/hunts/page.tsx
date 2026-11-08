import Link from "next/link";
import { getScan, getSettings, listHunts } from "@/lib/data";
import { aiConfigured } from "@/lib/ai/claude";
import { listScoutRuns } from "@/lib/ai/scout";
import type { Hunt } from "@/lib/deals";
import { ago, money } from "@/lib/format";
import { ActionForm, Submit } from "@/components/ActionForm";
import { deleteHuntAction, runScoutAction, saveHuntAction, scanHuntAction } from "../../actions";

const REJECT_LABEL: Record<string, string> = {
  titleMismatch: "다른 물건",
  junk: "고장/부품/박스",
  condition: "상태 다름",
  auctionOnly: "경매",
  overMaxBuy: "상한 초과",
  lowProfit: "이익 부족",
  lowRoi: "수익률 부족",
  noEstimate: "시세 못 구함",
};

function HuntFields({ hunt }: { hunt?: Hunt }) {
  return (
    <div className="grid">
      {hunt && <input type="hidden" name="id" value={hunt.id} />}
      <label className="wide">
        검색어 <small>eBay 검색과 같음. <code>-단어</code> 로 제외</small>
        <input name="query" defaultValue={hunt?.query} placeholder="nintendo switch oled -lite" required />
      </label>
      <label>
        상태
        <select name="condition" defaultValue={hunt?.condition ?? "used"}>
          <option value="used">중고</option>
          <option value="new">새 제품</option>
          <option value="parts">부품용</option>
        </select>
      </label>
      <label>
        카테고리 ID <small>선택</small>
        <input name="categoryId" defaultValue={hunt?.categoryId} inputMode="numeric" />
      </label>
      <label>
        매입 상한 ($)
        <input name="maxBuy" type="number" step="1" defaultValue={hunt?.maxBuy} />
      </label>
      <label>
        최소 순이익 ($)
        <input name="minProfit" type="number" step="1" defaultValue={hunt?.minProfit ?? 20} />
      </label>
      <label>
        최소 수익률 (%)
        <input name="minRoi" type="number" step="1" defaultValue={Math.round((hunt?.minRoi ?? 0.25) * 100)} />
      </label>
      <label className="wide">
        제외 단어 <small>쉼표로 구분</small>
        <input name="excludes" defaultValue={hunt?.excludes.join(", ")} placeholder="joy-con only, dock" />
      </label>
    </div>
  );
}

export default async function HuntsPage() {
  const hunts = await listHunts();
  const scans = await Promise.all(hunts.map((h) => getScan(h.id)));
  const ai = aiConfigured();
  const [runs, settings] = await Promise.all([listScoutRuns(), getSettings()]);
  const claudeCount = hunts.filter((h) => h.source === "claude").length;

  return (
    <>
      <h1>사냥 목록</h1>
      <p className="hint">
        잘 아는 물건일수록 좋아요. 모델명·용량까지 구체적으로 적어야 시세가 정확해져요. 사냥 하나에 eBay API 를 3번 씁니다 (하루 기본 한도 5,000회).
      </p>

      <section className="card scout">
        <div className="row spread">
          <div>
            <h2>Claude 정찰병</h2>
            <p className="hint">
              {ai
                ? `Claude 가 내 매매 성적과 eBay 시세를 직접 확인해서 사냥을 추가·조정·중단해요. Claude 사냥 ${claudeCount}/${settings.ai.maxHunts}개 · 물건당 최대 $${settings.ai.maxBuyPerItem} · 매일 자동 정찰 ${settings.ai.autopilot ? "켜짐" : "꺼짐"}`
                : "ANTHROPIC_API_KEY 를 설정하면 Claude 가 사냥감을 골라요."}{" "}
              <Link href="/settings#claude">설정</Link>
            </p>
          </div>
          {ai && (
            <ActionForm action={runScoutAction}>
              <Submit pending="Claude 가 시세 보는 중… (1~3분)">지금 정찰</Submit>
            </ActionForm>
          )}
        </div>
        {runs.slice(0, 3).map((r) => (
          <div key={r.at} className="run">
            <p className="hint">
              {ago(r.at)} · 시세 확인 {r.probes}번
            </p>
            {r.error ? <p className="msg error">{r.error}</p> : <p>{r.summary}</p>}
            {r.changes.length > 0 && (
              <ul>
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <div className="list">
        {hunts.map((h, i) => {
          const s = scans[i];
          return (
            <article key={h.id} className="card">
              <div className="row spread">
                <div>
                  <h3>
                    {h.query}
                    {h.source === "claude" && <span className="badge claude">Claude</span>}
                  </h3>
                  {h.reason && <p className="hint">{h.reason}</p>}
                  <p className="hint">
                    {h.condition === "new" ? "새 제품" : h.condition === "parts" ? "부품용" : "중고"} · 최소 {money(h.minProfit)} / {Math.round(h.minRoi * 100)}%
                    {h.maxBuy ? ` · 상한 ${money(h.maxBuy)}` : ""}
                  </p>
                </div>
                <ActionForm action={scanHuntAction}>
                  <input type="hidden" name="id" value={h.id} />
                  <Submit variant="ghost" pending="스캔 중…">
                    스캔
                  </Submit>
                </ActionForm>
              </div>
              {s && (
                <p className="hint">
                  {ago(s.scannedAt)} · 시세 {money(s.estimate?.quickSale)} (중간값 {money(s.estimate?.median)}, {s.estimate?.source === "sold" ? "판매완료" : "판매중"}{" "}
                  {s.compCount}건, 신뢰도 {s.estimate?.confidence ?? "—"}) · 딜 {s.deals.length}개 · 걸러짐{" "}
                  {Object.entries(s.rejected)
                    .map(([k, v]) => `${REJECT_LABEL[k] ?? k} ${v}`)
                    .join(", ") || "없음"}
                </p>
              )}
              <details>
                <summary>수정</summary>
                <ActionForm action={saveHuntAction} className="stack">
                  <HuntFields hunt={h} />
                  <Submit>저장</Submit>
                </ActionForm>
                <form action={deleteHuntAction}>
                  <input type="hidden" name="id" value={h.id} />
                  <button className="btn danger small">삭제</button>
                </form>
              </details>
            </article>
          );
        })}
      </div>

      <section className="card">
        <h2>새 사냥</h2>
        <ActionForm action={saveHuntAction} className="stack">
          <HuntFields />
          <Submit>추가</Submit>
        </ActionForm>
      </section>
    </>
  );
}
