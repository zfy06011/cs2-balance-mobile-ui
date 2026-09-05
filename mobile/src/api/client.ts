/**
 * API 客户端：负责与后端 FastAPI 通信。
 * 后端地址可在设置页修改并持久化到 AsyncStorage。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = '@cs2balance/api_base';

// 默认地址：
// - Android 模拟器访问宿主机用 10.0.2.2
// - iOS 模拟器/Web 用 localhost
// - 真机需改为电脑局域网 IP（如 http://192.168.1.x:8000/api/v1）
function defaultBase(): string {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000/api/v1';
  }
  return 'http://localhost:8000/api/v1';
}

let cachedBase: string | null = null;

export async function getApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  cachedBase = stored && stored.trim() ? stored.trim() : defaultBase();
  return cachedBase;
}

export async function setApiBase(base: string): Promise<void> {
  const normalized = base.replace(/\/+$/, '');
  cachedBase = normalized;
  await AsyncStorage.setItem(STORAGE_KEY, normalized);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getApiBase();
  const url = `${base}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`请求失败 ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

export interface Quote {
  market_hash_name: string;
  c5_buy_price: number | null;
  steam_sell_price: number | null;
  steam_volume: number | null;
  c5_fee_ratio: number;
  steam_seller_receive_ratio: number;
  lock_days: number;
  steam_net_receive: number | null;
  net_profit: number | null;
  roi: number | null;
  breakeven_sell_price: number | null;
  signal: string;
}

export interface RadarItem {
  market_hash_name: string;
  c5_buy_price: number | null;
  steam_sell_price: number | null;
  expected_roi: number | null;
  risk_level: string;
  liquidity: string;
  signal: string;
  score: number;
  details: Record<string, number>;
}

export interface Scenario {
  label: string;
  predicted_sell_price: number;
  net_profit: number;
  roi: number;
}

export interface Prediction {
  item_id: number;
  market_hash_name: string;
  model_version: string;
  target_at: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  prob_profit: number;
  prob_loss: number;
  confidence: number;
  scenarios: Scenario[];
}

export interface InventoryEntry {
  id: number;
  item_name: string;
  quantity: number;
  buy_price: number;
  buy_at: string;
  source: string;
  unlock_at: string;
  days_left: number;
  current_estimate: number | null;
  net_receive_estimate: number | null;
  net_profit_estimate: number | null;
  roi_estimate: number | null;
}

export interface Simulation {
  budget: number;
  allocation: string;
  items: SimulationItem[];
  total_buy_cost: number;
  expected_steam_receive: number;
  expected_net_profit: number;
  expected_roi: number;
  weighted_loss_prob: number;
}

export interface SimulationItem {
  name: string;
  qty: number;
  buy_cost: number;
  expected_receive: number;
  expected_roi: number;
  prob_loss: number;
}

export const api = {
  health: () => request<{ status: string; app: string }>('/health'),
  radar: () => request<RadarItem[]>('/radar'),
  quote: (name: string) => request<Quote>(`/quote/${encodeURIComponent(name)}`),
  prediction: (name: string) => request<Prediction>(`/prediction/${encodeURIComponent(name)}`),
  inventory: () => request<InventoryEntry[]>('/inventory'),
  addInventory: (params: { item_name: string; quantity: number; buy_price: number }) =>
    request<{ id: number; unlock_at: string; days: number }>(
      `/inventory?item_name=${encodeURIComponent(params.item_name)}&quantity=${params.quantity}&buy_price=${params.buy_price}`
    , { method: 'POST' }),
  simulate: (budget: number, allocation: string) =>
    request<Simulation>(`/simulate?budget=${budget}&allocation=${allocation}`),
  simulateReverse: (target: number, roi: number = 0.03) =>
    request<{ target_balance: number; required_budget: number; expected_profit: number }>(
      `/simulate/reverse?target_balance=${target}&roi=${roi}`),
};
