"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** 서버 액션 폼 + 결과 메시지. */
export function ActionForm({ action, children, className }: { action: Action; children: ReactNode; className?: string }) {
  const [state, run] = useActionState(action, undefined);
  return (
    <form action={run} className={className}>
      {children}
      {state?.error && <p className="msg error">{state.error}</p>}
      {state?.ok && <p className="msg ok">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, variant = "primary", pending: pendingLabel }: { children: ReactNode; variant?: "primary" | "ghost" | "danger"; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending}>
      {pending ? (pendingLabel ?? "처리 중…") : children}
    </button>
  );
}
