import type { Deal, Verdict } from "@/lib/deals";
import { WARNING_LABEL } from "@/lib/deals";
import { money, pct } from "@/lib/format";
import { markBoughtAction } from "@/app/actions";
import { ActionForm, Submit } from "./ActionForm";

const VERDICT: Record<Verdict, string> = { buy: "Claude: 사세요", check: "Claude: 확인 필요", skip: "Claude: 거르세요" };

export function DealCard({ deal }: { deal: Deal }) {
  const { listing: l, breakdown: b, estimate: e } = deal;
  const c = l.currency;
  return (
    <article className="card deal">
      {l.imageUrl ? <img src={l.imageUrl} alt="" className="thumb" loading="lazy" /> : <div className="thumb" />}
      <div className="body">
        {deal.review && (
          <p className={`verdict ${deal.review.verdict}`}>
            <b>{VERDICT[deal.review.verdict]}</b> {deal.review.reason}
          </p>
        )}
        <a href={l.webUrl} target="_blank" rel="noreferrer" className="title">
          {l.title}
        </a>
        <div className="figures">
          <div>
            <span className="label">매입</span>
            <b>{money(b.buyPrice + b.buyShipping, c)}</b>
            <small>{l.shipping === undefined ? "배송비 추정" : l.shipping === 0 ? "무료배송" : `배송 ${money(l.shipping, c)}`}</small>
          </div>
          <div>
            <span className="label">되팔기</span>
            <b>{money(b.saleTotal, c)}</b>
            <small>
              시세 {money(e.median, c)} · {e.source === "sold" ? "판매완료" : "판매중"} {e.sampleSize}건
            </small>
          </div>
          <div className="profit">
            <span className="label">순이익</span>
            <b>{money(b.profit, c)}</b>
            <small>수익률 {pct(b.roi)}</small>
          </div>
        </div>
        <details className="breakdown">
          <summary>계산 내역</summary>
          <table>
            <tbody>
              <tr><td>매입가 + 배송</td><td>{money(b.buyPrice + b.buyShipping, c)}</td></tr>
              <tr><td>매입 판매세</td><td>{money(b.purchaseTax, c)}</td></tr>
              <tr><td>eBay 판매 수수료</td><td>−{money(b.finalValueFee, c)}</td></tr>
              <tr><td>주문당 수수료</td><td>−{money(b.perOrderFee, c)}</td></tr>
              {b.promotedFee > 0 && <tr><td>광고비</td><td>−{money(b.promotedFee, c)}</td></tr>}
              <tr><td>발송 배송비 + 포장</td><td>−{money(b.outboundShipping + b.packaging, c)}</td></tr>
              <tr><td>정산 후 손에 남는 돈</td><td>{money(b.proceeds, c)}</td></tr>
            </tbody>
          </table>
          <p className="hint">
            시세 범위 {money(e.low, c)}–{money(e.high, c)}, 신뢰도 {e.confidence}. 판매자 {l.sellerName} ({l.sellerFeedbackPercent ?? "?"}%, {l.sellerFeedbackScore ?? "?"}) · {l.country}
          </p>
        </details>
        {deal.warnings.length > 0 && (
          <ul className="warnings">
            {deal.warnings.map((w) => (
              <li key={w}>{WARNING_LABEL[w]}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <a className="btn primary" href={l.webUrl} target="_blank" rel="noreferrer">
            eBay 에서 사기
          </a>
          <details className="bought">
            <summary className="btn ghost">샀어요</summary>
            <ActionForm action={markBoughtAction} className="inline">
              <input type="hidden" name="huntId" value={deal.huntId} />
              <input type="hidden" name="itemId" value={l.itemId} />
              <label>
                실제 가격 <input name="price" type="number" step="0.01" defaultValue={l.price} />
              </label>
              <label>
                배송비 <input name="shipping" type="number" step="0.01" defaultValue={b.buyShipping} />
              </label>
              <Submit pending="추가 중…">재고에 추가</Submit>
            </ActionForm>
          </details>
        </div>
      </div>
    </article>
  );
}
