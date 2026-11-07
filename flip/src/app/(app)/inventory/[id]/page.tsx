import { notFound } from "next/navigation";
import { getInventoryItem, getSettings } from "@/lib/data";
import { ebayConfig } from "@/lib/ebay/config";
import { money, pct, STATUS_LABEL } from "@/lib/format";
import { CONDITION_LABEL, validateDraft } from "@/lib/listing";
import { itemProfit } from "@/lib/pnl";
import { ActionForm, Submit } from "@/components/ActionForm";
import { PhotoUploader } from "@/components/PhotoUploader";
import {
  deleteItemAction,
  markSoldAction,
  publishAction,
  removePhotoAction,
  repriceAction,
  saveDraftAction,
  setStatusAction,
  updateShippingAction,
} from "../../../actions";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [item, settings] = await Promise.all([getInventoryItem(id), getSettings()]);
  if (!item) notFound();
  const d = item.draft;
  const p = itemProfit(item, settings.fees);
  const c = item.currency;
  const problems = d ? validateDraft(d, settings) : ["초안이 없어요."];
  const ebayHost = ebayConfig().sandbox ? "https://sandbox.ebay.com" : "https://www.ebay.com";

  return (
    <>
      <div className="item-head">
        {item.imageUrl && <img src={d?.imageUrls[0] ?? item.imageUrl} alt="" className="hero" />}
        <div>
          <span className={`badge ${item.status}`}>{STATUS_LABEL[item.status]}</span>
          <h1>{item.title}</h1>
          <p className="hint">
            {item.sourceUrl && (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                산 매물
              </a>
            )}
            {item.listingId && (
              <>
                {" · "}
                <a href={`${ebayHost}/itm/${item.listingId}`} target="_blank" rel="noreferrer">
                  내 리스팅 {item.listingId}
                </a>
              </>
            )}
          </p>
          <div className="stats">
            <div>
              <span className="label">원가</span>
              <b>{money(p.cost, c)}</b>
              <small>
                {money(item.buyPrice, c)} + 배송 {money(item.buyShipping, c)} + 세금 {money(item.buyTax, c)}
              </small>
            </div>
            <div>
              <span className="label">{p.realized ? "판매액" : "판매 예정가"}</span>
              <b>{money(p.saleTotal, c)}</b>
              <small>수수료 {money(p.finalValueFee + p.perOrderFee + p.promotedFee, c)}</small>
            </div>
            <div>
              <span className="label">{p.realized ? "이익" : "예상 이익"}</span>
              <b className={p.profit >= 0 ? "pos" : "neg"}>{money(p.profit, c)}</b>
              <small>{pct(p.roi)}</small>
            </div>
          </div>
        </div>
      </div>

      {item.lastError && <p className="msg error">마지막 등록 시도 실패: {item.lastError}</p>}

      {item.status === "bought" && d && (
        <>
          <section className="card">
            <h2>사진</h2>
            <p className="hint">물건이 도착하면 직접 찍어서 올려 주세요. 남의 리스팅 사진을 쓰면 eBay 정책 위반이에요.</p>
            <div className="photos">
              {d.imageUrls.map((u) => (
                <form key={u} action={removePhotoAction} className="photo">
                  <img src={u} alt="" />
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="url" value={u} />
                  <button className="btn danger small">빼기</button>
                </form>
              ))}
            </div>
            <PhotoUploader id={item.id} />
          </section>

          <section className="card">
            <h2>등록 초안</h2>
            <ActionForm action={saveDraftAction} className="stack">
              <input type="hidden" name="id" value={item.id} />
              <div className="grid">
                <label className="wide">
                  제목 <small>80자 이내, 영어</small>
                  <input name="title" defaultValue={d.title} maxLength={80} required />
                </label>
                <label>
                  가격 ({c})
                  <input name="price" type="number" step="0.01" defaultValue={d.price} required />
                </label>
                <label>
                  상태
                  <select name="condition" defaultValue={d.condition}>
                    {Object.entries(CONDITION_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v} ({k})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  카테고리 ID
                  <input name="categoryId" defaultValue={d.categoryId} inputMode="numeric" />
                </label>
                <label className="wide">
                  상태 설명 <small>선택, 흠집 등</small>
                  <input name="conditionDescription" defaultValue={d.conditionDescription} maxLength={1000} />
                </label>
                <label className="wide">
                  스펙 <small>한 줄에 하나, &quot;이름: 값, 값&quot;</small>
                  <textarea
                    name="aspects"
                    rows={6}
                    defaultValue={Object.entries(d.aspects)
                      .map(([k, v]) => `${k}: ${v.join(", ")}`)
                      .join("\n")}
                  />
                </label>
                <label className="wide">
                  설명 <small>HTML 가능</small>
                  <textarea name="description" rows={8} defaultValue={d.description} />
                </label>
                <label>
                  실제 산 가격
                  <input name="buyPrice" type="number" step="0.01" defaultValue={item.buyPrice} />
                </label>
                <label>
                  실제 매입 배송비
                  <input name="buyShipping" type="number" step="0.01" defaultValue={item.buyShipping} />
                </label>
                <label>
                  실제 매입 세금
                  <input name="buyTax" type="number" step="0.01" defaultValue={item.buyTax} />
                </label>
                <label className="wide">
                  메모
                  <input name="notes" defaultValue={item.notes} />
                </label>
              </div>
              <Submit variant="ghost">초안 저장</Submit>
            </ActionForm>
          </section>

          <section className="card">
            <h2>eBay 에 올리기</h2>
            {problems.length ? (
              <ul className="warnings">
                {problems.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                {money(d.price, c)} 고정가로 올라가요. 초안을 고쳤다면 먼저 저장하세요.
              </p>
            )}
            <ActionForm action={publishAction}>
              <input type="hidden" name="id" value={item.id} />
              <Submit pending="등록 중…">지금 등록</Submit>
            </ActionForm>
          </section>
        </>
      )}

      {item.status === "listed" && (
        <section className="card">
          <h2>판매중</h2>
          <ActionForm action={repriceAction} className="inline">
            <input type="hidden" name="id" value={item.id} />
            <label>
              가격 바꾸기
              <input name="price" type="number" step="0.01" defaultValue={d?.price} />
            </label>
            <Submit variant="ghost">적용</Submit>
          </ActionForm>
          <p className="hint">팔리면 재고 화면의 &quot;판매 확인&quot;이 주문을 찾아 자동으로 옮겨요. 다른 데서 팔았다면 아래에 직접 적으세요.</p>
          <ActionForm action={markSoldAction} className="inline">
            <input type="hidden" name="id" value={item.id} />
            <label>
              판매액 (세금 제외)
              <input name="saleTotal" type="number" step="0.01" defaultValue={d?.price} />
            </label>
            <label>
              라벨비
              <input name="actualShipping" type="number" step="0.01" defaultValue={settings.fees.outboundShipping} />
            </label>
            <Submit variant="ghost">팔렸어요</Submit>
          </ActionForm>
        </section>
      )}

      {item.status === "sold" && (
        <section className="card">
          <h2>판매 완료</h2>
          <ActionForm action={updateShippingAction} className="inline">
            <input type="hidden" name="id" value={item.id} />
            <label>
              판매액 (세금 제외)
              <input name="saleTotal" type="number" step="0.01" defaultValue={item.saleTotal} />
            </label>
            <label>
              실제 라벨비
              <input name="actualShipping" type="number" step="0.01" defaultValue={item.actualShipping ?? settings.fees.outboundShipping} />
            </label>
            <Submit variant="ghost">저장</Submit>
          </ActionForm>
        </section>
      )}

      <div className="row">
        {item.status === "bought" && (
          <form action={setStatusAction}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="status" value="cancelled" />
            <button className="btn ghost small">취소/반품 처리</button>
          </form>
        )}
        {item.status === "cancelled" && (
          <form action={setStatusAction}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="status" value="bought" />
            <button className="btn ghost small">다시 재고로</button>
          </form>
        )}
        <form action={deleteItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <button className="btn danger small">삭제</button>
        </form>
      </div>
    </>
  );
}
