import Link from "next/link";
import { redirect } from "next/navigation";
import { isLoggedIn, passwordRequired } from "@/lib/auth";
import { logout } from "../actions";

export const dynamic = "force-dynamic";
// Claude 정찰(1~3분)과 전체 스캔이 서버 액션 안에서 돈다.
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isLoggedIn())) redirect("/login");
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">
          Flip
        </Link>
        <nav>
          <Link href="/">딜</Link>
          <Link href="/hunts">사냥 목록</Link>
          <Link href="/inventory">재고</Link>
          <Link href="/settings">설정</Link>
        </nav>
        {passwordRequired() && (
          <form action={logout}>
            <button className="btn ghost small">나가기</button>
          </form>
        )}
      </header>
      <main className="page">{children}</main>
    </>
  );
}
