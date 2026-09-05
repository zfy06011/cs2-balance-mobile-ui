/**
 * format：UI 展示层格式化（HANDOFF v2.0 第 19 节：ROI → 预计赚多少，折扣 → 几折）。
 */
import { displayName, UNKNOWN_CN_NAME } from '../data/cn_names';

export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '--';
  return `¥${v.toFixed(digits)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '--';
  return `${(v * 100).toFixed(digits)}%`;
}

/** 预计几折：0.926 → "9.26 折"；null → "--" */
export function fmtZhe(discountNum: number | null | undefined, digits = 2): string {
  if (discountNum === null || discountNum === undefined || !Number.isFinite(discountNum)) return '--';
  return `${(discountNum * 10).toFixed(digits)} 折`;
}

/** 中文显示名；未收录时回退显示英文原名（后台仍用 MarketHashName 关联） */
export function displayNameOf(name: string): string {
  if (!name) return UNKNOWN_CN_NAME;
  return displayName(name);
}

/** 信号 → 人话结论 */
export const SIGNAL_TEXT: Record<string, string> = {
  buy: '推荐购买',
  wait: '可以观察',
  waiting: '等待数据',
  avoid: '暂时别买',
};
