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

/**
 * Steam 低价结算审计元数据。
 * 当前公开项目数据不足以确认最小货币单位取整/最低费用规则，因此这是近似模型，
 * 不是经过 Steam 第一方结算明细验证的 exact settlement calculator。
 */
export interface SteamFeeModelMetadata {
  name: 'estimatedSteamNetReceive';
  kind: 'approximate';
  exact: false;
  receiveRatio: number;
  unit: 'CNY';
  note: string;
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

export const STEAM_FEE_MODEL: SteamFeeModelMetadata = Object.freeze({
  name: 'estimatedSteamNetReceive',
  kind: 'approximate',
  exact: false,
  receiveRatio: DEFAULT_FEES.steam_seller_receive_ratio,
  unit: 'CNY',
  note: '固定到账比例近似模型；未从 Steam 第一方结算明细确认低价最小货币单位取整和最低费用规则',
});

export const FEE_SOURCES: Record<string, string> = {
  steam_seller_receive_ratio: '项目近似模型：固定到账比例 0.8696；低价取整规则尚未由第一方结算明细确认',
  c5_buy_fee_ratio: 'C5GAME 公告 2026-04-09：CS2 交易手续费普通用户 1%',
  c5_withdrawal_fee_ratio: 'C5GAME 公告：提现手续费约 0.9%',
};
