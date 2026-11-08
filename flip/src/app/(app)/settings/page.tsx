import { getSettings } from "@/lib/data";
import { ebayConfig, isConfigured } from "@/lib/ebay/config";
import { userConnection } from "@/lib/ebay/oauth";
import { listPolicies, type SellerPolicies } from "@/lib/ebay/sell";
import type { FeeSettings } from "@/lib/fees";
import { ActionForm, Submit } from "@/components/ActionForm";
import {
  connectEbayAction,
  disconnectEbayAction,
  pasteCodeAction,
  saveAddressAction,
  saveAiSettingsAction,
  saveFeesAction,
  savePoliciesAction,
} from "../../actions";
import { aiConfigured } from "@/lib/ai/claude";

const FEE_INPUTS: { key: keyof FeeSettings; label: string; percent?: boolean; hint?: string }[] = [
  { key: "finalValueFeeRate", label: "판매 수수료율 (%)", percent: true, hint: "미국 대부분 13.6%, 카테고리마다 다름" },
  { key: "perOrderFeeHigh", label: "주문당 수수료 ($)", hint: "$10 초과 주문" },
  { key: "perOrderFeeLow", label: "주문당 수수료, 소액 ($)" },
  { key: "perOrderFeeThreshold", label: "소액 기준 ($)" },
  { key: "resaleTaxRate", label: "구매자 판매세 평균 (%)", percent: true, hint: "수수료가 세금 포함액에 붙어서 필요" },
  { key: "promotedRate", label: "광고비율 (%)", percent: true },
  { key: "purchaseTaxRate", label: "내가 살 때 판매세 (%)", percent: true, hint: "리셀 증명서 있으면 0" },
  { key: "outboundShipping", label: "보낼 때 라벨비 ($)" },
  { key: "packaging", label: "포장비 ($)" },
  { key: "unknownShippingEstimate", label: "배송비 미표시 매물 가정치 ($)" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ oauth?: string }> }) {
  const { oauth } = await searchParams;
  const configured = isConfigured();
  const cfg = configured ? ebayConfig() : undefined;
  const [settings, connection] = await Promise.all([getSettings(), configured ? userConnection() : undefined]);

  let policies: SellerPolicies | undefined;
  let policyError: string | undefined;
  if (connection) {
    try {
      policies = await listPolicies();
    } catch (e) {
      policyError = (e as Error).message;
    }
  }
  const base = process.env.PUBLIC_BASE_URL ?? "";

  return (
    <>
      <h1>설정</h1>
      {oauth && <p className={`msg ${oauth === "연결됨" ? "ok" : "error"}`}>eBay 계정: {oauth}</p>}

      <section className="card">
        <h2>eBay 개발자 키</h2>
        {cfg ? (
          <p className="hint">
            {cfg.sandbox ? "샌드박스" : "실서비스"} · {cfg.marketplace.id} ({cfg.marketplace.currency}) · RuName {cfg.ruName ? "있음" : "없음 (계정 연결 불가)"} · 판매완료 시세{" "}
            {process.env.EBAY_USE_INSIGHTS === "1" ? "사용" : "안 씀"}
          </p>
        ) : (
          <p className="msg error">EBAY_CLIENT_ID / EBAY_CLIENT_SECRET 이 없어요.</p>
        )}
      </section>

      <section className="card">
        <h2>내 eBay 계정</h2>
        {connection ? (
          <>
            <p className="msg ok">
              연결됨 · {new Date(connection.connectedAt).toLocaleDateString("ko-KR")} · 갱신 토큰 만료 {new Date(connection.refreshTokenExpiresAt).toLocaleDateString("ko-KR")}
            </p>
            <form action={disconnectEbayAction}>
              <button className="btn ghost small">연결 끊기</button>
            </form>
          </>
        ) : (
          <>
            <p className="hint">등록·주문 확인에 필요해요. 검색만 할 거면 안 해도 됩니다.</p>
            <form action={connectEbayAction}>
              <button className="btn primary" disabled={!cfg?.ruName}>
                eBay 로그인
              </button>
            </form>
            <details>
              <summary>eBay 완료 페이지에서 멈췄다면</summary>
              <p className="hint">
                RuName 의 accept URL 을 <code>{base || "https://내-주소"}/api/oauth/callback</code> 로 걸어두면 자동이에요. 아니면 로그인 후 보이는 페이지의 주소를 통째로 복사해서 아래에 붙여넣으세요 (5분 안에).
              </p>
              <ActionForm action={pasteCodeAction} className="inline">
                <input name="code" placeholder="https://auth2.ebay.com/...&code=..." />
                <Submit variant="ghost">연결</Submit>
              </ActionForm>
            </details>
          </>
        )}
      </section>

      {connection && (
        <section className="card">
          <h2>판매 정책</h2>
          {policyError && <p className="msg error">{policyError}</p>}
          {policies && (policies.fulfillment.length === 0 || policies.payment.length === 0 || policies.return.length === 0) ? (
            <p className="msg error">
              eBay 판매자 허브 → Account → Business policies 에서 배송·결제·반품 정책을 하나씩 만들어 주세요 (처음이면 &quot;opt in&quot; 필요).
            </p>
          ) : (
            policies && (
              <ActionForm action={savePoliciesAction} className="grid">
                {(["fulfillment", "payment", "return"] as const).map((k) => (
                  <label key={k}>
                    {k === "fulfillment" ? "배송" : k === "payment" ? "결제" : "반품"}
                    <select
                      name={k}
                      defaultValue={
                        k === "fulfillment" ? settings.policies?.fulfillmentPolicyId : k === "payment" ? settings.policies?.paymentPolicyId : settings.policies?.returnPolicyId
                      }
                    >
                      {policies[k].map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <Submit variant="ghost">저장</Submit>
              </ActionForm>
            )
          )}
        </section>
      )}

      {connection && (
        <section className="card">
          <h2>발송지</h2>
          <p className="hint">eBay 에 &quot;어디서 보내는지&quot; 알려주는 용도예요. 상세 주소는 필요 없어요.</p>
          <ActionForm action={saveAddressAction} className="grid">
            <label>
              도시
              <input name="city" defaultValue={settings.address?.city} required />
            </label>
            <label>
              주/도
              <input name="stateOrProvince" defaultValue={settings.address?.stateOrProvince} />
            </label>
            <label>
              우편번호
              <input name="postalCode" defaultValue={settings.address?.postalCode} required />
            </label>
            <label>
              국가코드
              <input name="country" defaultValue={settings.address?.country ?? cfg?.marketplace.country} maxLength={2} required />
            </label>
            <Submit variant="ghost">저장</Submit>
          </ActionForm>
        </section>
      )}

      <section className="card" id="claude">
        <h2>Claude</h2>
        {aiConfigured() ? (
          <ActionForm action={saveAiSettingsAction} className="grid">
            <label className="check wide">
              <input type="checkbox" name="autopilot" defaultChecked={settings.ai.autopilot} />
              매일 자동 정찰 (크론이 스캔 전에 Claude 에게 사냥 목록을 고치게 함)
            </label>
            <label>
              Claude 사냥 최대 개수
              <input name="maxHunts" type="number" min={1} max={30} defaultValue={settings.ai.maxHunts} />
            </label>
            <label>
              물건당 최대 매입가 ($)
              <input name="maxBuyPerItem" type="number" step="1" defaultValue={settings.ai.maxBuyPerItem} />
            </label>
            <label className="wide">
              Claude 에게 주는 방향 <small>예: 게임기·오디오 위주, 부피 큰 것 제외, 애플 제품은 빼기</small>
              <textarea name="guidance" rows={3} defaultValue={settings.ai.guidance} maxLength={1000} />
            </label>
            <Submit variant="ghost">저장</Submit>
          </ActionForm>
        ) : (
          <p className="hint">
            <code>ANTHROPIC_API_KEY</code> 환경변수를 넣으면 Claude 가 사냥감을 고르고, 스캔한 딜을 사기 전에 검토해요.
          </p>
        )}
      </section>

      <section className="card">
        <h2>수수료·비용</h2>
        <ActionForm action={saveFeesAction} className="grid">
          {FEE_INPUTS.map((f) => (
            <label key={f.key}>
              {f.label} {f.hint && <small>{f.hint}</small>}
              <input
                name={f.key}
                type="number"
                step="0.01"
                defaultValue={f.percent ? Math.round(settings.fees[f.key] * 10000) / 100 : settings.fees[f.key]}
              />
            </label>
          ))}
          <Submit variant="ghost">저장</Submit>
        </ActionForm>
      </section>
    </>
  );
}
