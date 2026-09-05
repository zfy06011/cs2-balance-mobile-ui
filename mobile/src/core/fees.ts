/**
 * fees：手续费配置（与后端 services/fees.py 对齐）。
 * 费率可配置版本化；这里提供本地默认值。
 */
export interface FeeBundle {
  steam_seller_receive_ratio: number;
  c5_buy_fee_ratio: number;
  c5_withdrawal_fee_ratio: number;
  fee_version: string;
}

export const DEFAULT_FEES: FeeBundle = {
  // Steam 市场：约 15%（10% Steam + 5% 游戏内），卖家实得 = 挂牌价 / 1.15
  steam_seller_receive_ratio: 0.8696,
  // C5GAME：2026-04-09 起普通用户 CS2 交易手续费 1%
  c5_buy_fee_ratio: 0.01,
  // C5GAME 提现手续费（仅供参考，不计入单笔倒余额成本）
  c5_withdrawal_fee_ratio: 0.009,
  fee_version: 'defaults',
};

export const FEE_SOURCES: Record<string, string> = {
  steam_seller_receive_ratio: 'Steam 市场官方：10% Steam 费用 + 5% 游戏内费用，卖家实得 1/1.15≈86.96%',
  c5_buy_fee_ratio: 'C5GAME 公告 2026-04-09：CS2 交易手续费普通用户 1%',
  c5_withdrawal_fee_ratio: 'C5GAME 公告：提现手续费约 0.9%',
};
