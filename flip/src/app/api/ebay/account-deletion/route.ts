// eBay 실서비스 키를 켜려면 "계정 삭제 알림" 엔드포인트가 필수다.
// 이 앱은 다른 eBay 사용자의 개인정보를 저장하지 않으므로 받기만 하고 200 을 돌려준다.
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function endpointUrl() {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/ebay/account-deletion`;
}

export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("challenge_code");
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  if (!challenge || !token || !process.env.PUBLIC_BASE_URL) return NextResponse.json({ error: "not configured" }, { status: 400 });
  const challengeResponse = createHash("sha256").update(challenge).update(token).update(endpointUrl()).digest("hex");
  return NextResponse.json({ challengeResponse });
}

export async function POST() {
  return new NextResponse(null, { status: 204 });
}
