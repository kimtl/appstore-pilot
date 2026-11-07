"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPhotoAction } from "@/app/actions";

const MAX_EDGE = 1600;

/** 브라우저에서 긴 변 1600px JPEG 로 줄인 뒤 한 장씩 올린다 (서버 요청 크기 제한 회피). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/jpeg", 0.88));
}

export function PhotoUploader({ id }: { id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const router = useRouter();

  async function onChange(files: FileList | null) {
    if (!files?.length) return;
    setError(undefined);
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setStatus(`올리는 중 ${i + 1}/${list.length}`);
      try {
        const fd = new FormData();
        fd.append("photo", await shrink(list[i]), "photo.jpg");
        const r = await uploadPhotoAction(id, fd);
        if (r?.error) throw new Error(r.error);
      } catch (e) {
        setError((e as Error).message);
        break;
      }
    }
    setStatus(undefined);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="uploader">
      <input ref={input} type="file" accept="image/*" multiple onChange={(e) => onChange(e.target.files)} disabled={Boolean(status)} />
      {status && <p className="msg">{status}</p>}
      {error && <p className="msg error">{error}</p>}
    </div>
  );
}
