// RuName 의 accept URL 로 등록하는 주소. eBay 가 ?code=...&state=... 를 붙여서 돌려보낸다.
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { sessionValid, SESSION_COOKIE } from "@/lib/auth";
import { exchangeCode } from "@/lib/ebay/oauth";

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const back = (msg: string) => NextResponse.redirect(new URL(`/settings?oauth=${encodeURIComponent(msg)}`, req.url));

  if (!sessionValid(jar.get(SESSION_COOKIE)?.value)) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = jar.get("flip_oauth_state")?.value;
  jar.delete("flip_oauth_state");

  if (!code) return back("eBay 로그인이 취소됐어요.");
  if (!state || state !== expected) return back("state 가 맞지 않아요. 다시 시도해 주세요.");
  try {
    await exchangeCode(code);
    return back("연결됨");
  } catch (e) {
    return back((e as Error).message);
  }
}
