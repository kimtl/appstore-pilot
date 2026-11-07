import Link from "next/link";
import { getSettings, listInventory, type ItemStatus } from "@/lib/data";
import { money, pct, STATUS_LABEL } from "@/lib/format";
import { itemProfit, portfolio } from "@/lib/pnl";
import { ActionForm, Submit } from "@/components/ActionForm";
import { addByUrlAction, syncSalesAction } from "../../actions";


const ORDER: ItemStatus[] = ["bought", "listed", "sold", "cancelled"];

export default async function InventoryPage() {
  const [items, settings] = await Promise.all([listInventory(), getSettings()]);
  const p = portfolio(items, settings.fees);

  return (
    <>
      <div className="toolbar">
        <h1>재고</h1>
        <ActionForm action={syncSalesAction}>
          <Submit variant="ghost" pending="주문 확인 중…">
            판매 확인
          </Submit>
        </ActionForm>
      </div>

      <div className="stats">
        <div>
          <span className="label">실현 이익</span>
          <b>{money(p.realizedProfit)}</b>
          <small>{p.soldCount}건 판매</small>
        </div>
        <div>
          <span className="label">묶인 돈</span>
          <b>{money(p.openCost)}</b>
        </div>
        <div>
          <span className="label">예상 이익 (재고)</span>
          <b>{money(p.expectedProfit)}</b>
        </div>
      </div>

      {ORDER.map((status) => {
        const group = items.filter((i) => i.status === status);
        if (!group.length) return null;
        return (
          <section key={status}>
            <h2>
              {STATUS_LABEL[status]} <small>{group.length}</small>
            </h2>
            <div className="list">
              {group.map((i) => {
                const pr = itemProfit(i, settings.fees);
                return (
                  <Link key={i.id} href={`/inventory/${i.id}`} className="card item">
                    {i.draft?.imageUrls[0] || i.imageUrl ? <img src={i.draft?.imageUrls[0] ?? i.imageUrl} alt="" className="thumb" /> : <div className="thumb" />}
                    <div className="body">
                      <span className="title">{i.title}</span>
                      <span className="hint">
                        원가 {money(pr.cost, i.currency)} → {money(pr.saleTotal, i.currency)} · {pr.realized ? "이익" : "예상"}{" "}
                        <b className={pr.profit >= 0 ? "pos" : "neg"}>{money(pr.profit, i.currency)}</b> ({pct(pr.roi)})
                        {i.lastError ? " · ⚠ 등록 실패" : ""}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="card">
        <h2>직접 추가</h2>
        <p className="hint">딜 목록 밖에서 산 물건도 eBay 상품 주소만 있으면 추가할 수 있어요.</p>
        <ActionForm action={addByUrlAction} className="grid">
          <label className="wide">
            eBay 상품 주소
            <input name="url" placeholder="https://www.ebay.com/itm/123456789012" required />
          </label>
          <label>
            산 가격 ($)
            <input name="price" type="number" step="0.01" required />
          </label>
          <label>
            배송비 ($)
            <input name="shipping" type="number" step="0.01" defaultValue={0} />
          </label>
          <Submit>추가</Submit>
        </ActionForm>
      </section>
    </>
  );
}
