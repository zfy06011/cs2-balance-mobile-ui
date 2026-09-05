/**
 * buyFlow：一键买入安全流程（HANDOFF v2.0 第 9 节）。
 * 只做「核验 → 用户确认 → 写入本地库存/订单」，不调用任何未验证的下单接口。
 * 流程：prepareBuy（购买保护核验）→ 展示买入价/预计几折/预计到手/预算占用/限制期
 *      → 用户确认 → 若有二次确认警告再确认一次 → executeBuy 写库存 + 订单。
 */
import { Alert } from 'react-native';
import { api, BuyPrepareResult } from '../api/client';
import { displayNameOf, fmtMoney, fmtZhe } from './format';

export interface BuyFlowResult {
  ok: boolean;
  message: string;
  cancelled?: boolean;
}

export async function runBuyFlow(opts: {
  name: string;
  qty?: number;
  onDone?: (r: BuyFlowResult) => void;
}): Promise<BuyFlowResult> {
  const { name, qty } = opts;
  try {
    const pre: BuyPrepareResult = await api.prepareBuy({ name, qty });
    if (!pre.ok) {
      const message = pre.errors.join('；') || '购买条件不满足';
      Alert.alert('暂缓买入', message);
      opts.onDone?.({ ok: false, message });
      return { ok: false, message };
    }

    const lines = [
      `商品：${displayNameOf(pre.displayName)}`,
      `买入价：${fmtMoney(pre.summary.buyPrice)} × ${pre.qty}`,
      `预计几折：${fmtZhe(pre.summary.discountNum)}`,
      `预计 Steam 到手：${fmtMoney(pre.summary.netReceive)}`,
      `本次投入（含费用）：${fmtMoney(pre.summary.totalCost)}`,
      `限制期：约 ${pre.lockDays} 天`,
    ];
    if (pre.summary.netProfit != null) {
      lines.push(`预计赚/亏：${pre.summary.netProfit >= 0 ? '+' : ''}${fmtMoney(pre.summary.netProfit)}`);
    }

    const confirm = await new Promise<boolean>((resolve) => {
      Alert.alert('确认在 C5GAME 买入？', lines.join('\n'), [
        { text: '取消', style: 'cancel', onPress: () => resolve(false) },
        { text: '确认买入', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
    if (!confirm) {
      opts.onDone?.({ ok: false, cancelled: true, message: '已取消买入' });
      return { ok: false, cancelled: true, message: '已取消买入' };
    }

    if (pre.warnings.length > 0) {
      const again = await new Promise<boolean>((resolve) => {
        Alert.alert('购买前请再次确认', pre.warnings.join('\n'), [
          { text: '再想想', style: 'cancel', onPress: () => resolve(false) },
          { text: '仍然买入', style: 'destructive', onPress: () => resolve(true) },
        ]);
      });
      if (!again) {
        opts.onDone?.({ ok: false, cancelled: true, message: '已取消买入' });
        return { ok: false, cancelled: true, message: '已取消买入' };
      }
    }

    const res = await api.executeBuy({ name, qty });
    if (res.ok) {
      Alert.alert('买入已记录 ✅', `${res.message}\n（本地记账，待 C5GAME 官方开放下单接口后接入自动下单）`);
    } else {
      Alert.alert('买入失败', res.message);
    }
    opts.onDone?.({ ok: res.ok, message: res.message });
    return { ok: res.ok, message: res.message };
  } catch (e) {
    const message = e instanceof Error ? e.message : '买入流程异常';
    Alert.alert('买入失败', message);
    opts.onDone?.({ ok: false, message });
    return { ok: false, message };
  }
}
