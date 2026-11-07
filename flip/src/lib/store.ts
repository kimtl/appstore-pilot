// 혼자 쓰는 앱이라 DB 대신 키-값 저장소 하나로 충분하다.
// - Vercel: Upstash Redis (Vercel Marketplace 에서 연결하면 KV_REST_API_URL / KV_REST_API_TOKEN 이 자동으로 들어옴)
// - 로컬: ./data/*.json
import { promises as fs } from "node:fs";
import path from "node:path";

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

class RedisRestKV implements KV {
  constructor(
    private url: string,
    private token: string,
  ) {}

  private async call(cmd: string[], body?: string) {
    const res = await fetch(`${this.url}/${cmd.map(encodeURIComponent).join("/")}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis ${cmd[0]} 실패: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { result: unknown }).result;
  }

  async get<T>(key: string) {
    const raw = await this.call(["get", `flip:${key}`]);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : undefined;
  }
  async set(key: string, value: unknown) {
    await this.call(["set", `flip:${key}`], JSON.stringify(value));
  }
  async del(key: string) {
    await this.call(["del", `flip:${key}`]);
  }
}

class FileKV implements KV {
  constructor(private dir: string) {}
  private file(key: string) {
    return path.join(this.dir, `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }
  async get<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(key), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }
  async set(key: string, value: unknown) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file(key)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, this.file(key));
  }
  async del(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
}

export class MemoryKV implements KV {
  data = new Map<string, string>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown) {
    this.data.set(key, JSON.stringify(value));
  }
  async del(key: string) {
    this.data.delete(key);
  }
}

let instance: KV | undefined;

export function kv(): KV {
  if (instance) return instance;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) instance = new RedisRestKV(url.replace(/\/$/, ""), token);
  else if (process.env.VERCEL) throw new Error("Vercel 에서는 Upstash Redis 를 연결해야 합니다 (KV_REST_API_URL / KV_REST_API_TOKEN).");
  else instance = new FileKV(path.join(process.cwd(), "data"));
  return instance;
}

export function setKV(next: KV) {
  instance = next;
}
