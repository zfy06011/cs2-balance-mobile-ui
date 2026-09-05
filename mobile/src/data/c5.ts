/**
 * c5：C5GAME 直连适配器（手机端）。
 *
 * 官方 OpenAPI（https://opendoc.c5game.com）：
 *   端点：POST /merchant/product/price/batch
 *        （MarketHashNames 批量查询在售最低价和数量，文档 /api-125914570）
 *   鉴权：app-key 作为 query 参数，无需签名（默认限流 50 QPS）。
 *   请求体：{ "appId": "730", "marketHashNames": ["<MarketHashName>"] }
 *   价格单位：元（人民币），与 Steam priceoverview（CNY）一致，可直接参与 ROI 计算。
 *
 * 未配置 app-key / 请求失败 / 无数据时返回 null（禁止臆造价格），
 * 用户也可在商品详情页手动录入 C5 买入价兜底。
 */
const C5_API_BASE = 'https://openapi.c5game.com';
const C5_APP_ID = '730'; // CS:GO / CS2

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

export async function fetchC5Price(name: string, appKey: string): Promise<number | null> {
  if (!appKey || !appKey.trim()) return null;
  const key = appKey.trim();

  let resp: Response;
  try {
    resp = await fetch(`${C5_API_BASE}/merchant/product/price/batch?app-key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appId: C5_APP_ID, marketHashNames: [name] }),
    });
  } catch {
    return null;
  }
  if (!resp.ok) return null;

  let data: C5BatchResponse;
  try {
    data = (await resp.json()) as C5BatchResponse;
  } catch {
    return null;
  }
  if (!data || data.success !== true || !data.data) return null;
  const item = data.data[name];
  if (!item) return null;
  return toNumber(item.price);
}
