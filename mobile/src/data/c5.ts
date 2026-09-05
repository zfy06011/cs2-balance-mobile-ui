/**
 * c5：C5GAME 直连适配器（手机端）。
 *
 * 官方 OpenAPI（https://opendoc.c5game.com）：
 *   端点：POST /merchant/product/price/batch
 *        （MarketHashNames 批量查询在售最低价和数量，文档 /api-125914570）
 *   鉴权：app-key 作为 query 参数，无需签名（默认限流 50 QPS）。
 *   请求体：{ "appId": "730", "marketHashNames": ["<MarketHashName>"] }
 *   价格单位：元（人民币），与 Steam priceoverview（CNY）一致，可直接参与计算。
 *
 * 未配置 app-key / 请求失败 / 无数据时返回 null（禁止臆造价格），
 * 用户也可在商品详情页手动录入 C5 买入价兜底。
 */
const C5_API_BASE = 'https://openapi.c5game.com';
const C5_APP_ID = '730'; // CS:GO / CS2
/** 单次批量上限（保守，官方限流 50 QPS） */
export const C5_BULK_CHUNK = 30;

interface C5BatchItem {
  itemId?: string;
  marketHashName?: string;
  /** 在售最低价，单位：元 */
  price?: number | string;
  count?: number;
  website?: string;
}

interface C5BatchResponse {
  success?: boolean;
  data?: Record<string, C5BatchItem> | null;
  errorCode?: number;
  errorMsg?: string | null;
}

/** 把可能为字符串的金额转成 number，失败返回 null */
function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 真正批量查询：一次 POST 多个 MarketHashName，自动分批（每批 C5_BULK_CHUNK 个）。
 * 返回 { name: price|null }，单个失败置 null（不阻塞整批）。
 */
export async function fetchC5PricesBulk(
  names: string[],
  appKey: string,
  chunkSize = C5_BULK_CHUNK,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!appKey || !appKey.trim() || names.length === 0) return out;
  const key = appKey.trim();
  const uniq = [...new Set(names)].filter((n) => !!n);

  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    let map: Record<string, number | null> = {};
    try {
      const resp = await fetch(`${C5_API_BASE}/merchant/product/price/batch?app-key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appId: C5_APP_ID, marketHashNames: chunk }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as C5BatchResponse;
        if (data && data.success === true && data.data) {
          for (const n of chunk) {
            const item = data.data[n];
            map[n] = item ? toNumber(item.price) : null;
          }
        }
      }
    } catch {
      map = {};
    }
    for (const n of chunk) out[n] = map[n] ?? null;
  }
  return out;
}

/** 单条查询（批量接口的便捷封装） */
export async function fetchC5Price(name: string, appKey: string): Promise<number | null> {
  const r = await fetchC5PricesBulk([name], appKey, 1);
  return r[name] ?? null;
}
