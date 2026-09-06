/**
 * 环境变量与常量（Cloudflare Worker）。
 * 值均来自 wrangler.toml [vars] 或 secret（INGEST_TOKEN）。
 */
import type { D1DatabaseLike } from './db.ts';

export interface Env {
  DB: D1DatabaseLike;
  CRON_MINUTES?: string;
  CONCURRENCY?: string;
  STEAM_TIMEOUT_MS?: string;
  STEAM_RETRIES?: string;
  REQUEST_DELAY_MS?: string;
  HISTORY_DAYS?: string;
  TOP_CASES?: string;
  MAX_ITEMS_PER_RUN?: string;
  DEFAULT_HISTORY_DAYS?: string;
  /** 可选：/ingest 写入口鉴权 token（wrangler secret put INGEST_TOKEN） */
  INGEST_TOKEN?: string;
}

export const APPID = 730;
export const CURRENCY = 23;
export const MARKET_BASE = 'https://steamcommunity.com/market';

export function envNum(env: Env, key: keyof Env, def: number): number {
  const raw = env[key];
  const n = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}