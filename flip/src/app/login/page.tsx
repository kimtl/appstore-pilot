import { redirect } from "next/navigation";
import { login } from "../actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { isLoggedIn } from "@/lib/auth";

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/");
  const missing = !process.env.APP_PASSWORD;
  return (
    <main className="login">
      <h1>Flip</h1>
      {missing ? (
        <p className="msg error">APP_PASSWORD 환경변수를 설정해야 이 앱에 들어올 수 있어요.</p>
      ) : (
        <ActionForm action={login} className="stack">
          <input type="password" name="password" placeholder="비밀번호" autoFocus required autoComplete="current-password" />
          <Submit>들어가기</Submit>
        </ActionForm>
      )}
    </main>
  );
}
