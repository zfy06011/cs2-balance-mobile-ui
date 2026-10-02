package com.cs2balance.assistant.mvp.ui

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun money(cents: Long?): String = cents?.let { "¥ ${it / 100}.${(it % 100).toString().padStart(2, '0')}" } ?: "未取得"
fun time(value: String?): String = try {
    if (value == null) "未采集" else DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")
        .withZone(ZoneId.systemDefault()).format(Instant.parse(value))
} catch (_: Exception) { "时间不可用" }
fun category(value: String) = when (value) { "case" -> "武器箱"; "capsule" -> "胶囊"; "sticker" -> "贴纸"; else -> "商品" }
fun reason(code: String?): String = when (code) {
    null -> "未扫描"
    "credential_missing" -> "请先在设置中保存 C5 凭证"
    "credential_invalid", "auth_or_access" -> "凭证无效或没有接口访问权限"
    "credential_unreadable" -> "凭证读取失败，请在设置中重新保存或删除"
    "invalid_credential" -> "凭证格式不正确，请检查空格和长度"
    "credential_write_failed" -> "凭证保存失败，请重试"
    "rate_limited" -> "来源限流，已停止该来源并记录冷却"
    "cooldown", "server_cooldown" -> "来源仍在冷却，请稍后刷新"
    "timeout" -> "请求超时"
    "network" -> "网络请求失败，请检查网络"
    "fee_unverified" -> "手续费尚未核验，仅展示来源报价"
    "fee_inverse_ambiguous" -> "买家总额无法精确反推出卖家到账，不参与排行"
    "below_market_minimum" -> "报价低于钱包市场最低金额"
    "mapping_unverified", "mapping_or_availability" -> "商品映射或在售状态待核对"
    "currency_mismatch", "currency_or_price_format" -> "报价币种或格式不符合人民币要求"
    "mixed_batches" -> "报价来自不同扫描批次，不参与排行"
    "missing_current_quote" -> "本轮未取得完整报价，不参与排行"
    "empty_quote", "unavailable" -> "暂未取得有效在售报价"
    "schema", "c5_rejected" -> "来源响应未通过校验"
    "invalid_money", "nonpositive_or_invalid_quote" -> "金额无效，不参与排行"
    "unsupported_fee_parameters", "wallet_unconfirmed" -> "钱包手续费参数未确认或暂不支持"
    "fee_observations_missing" -> "请选择包含真实卖出对话框观察的 JSON 文件"
    "fee_coverage" -> "观察需含至少六个不同金额，覆盖低价和100元净到账"
    "fee_mismatch" -> "观察金额与手续费模型不一致，未导入"
    "fee_file_unreadable", "fee_file_too_large" -> "观察文件无法读取或过大"
    "cache_unreadable", "cache_version" -> "本地数据读取失败，原文件已保留"
    "cache_write_failed" -> "本地数据保存失败，已保留上一份文件"
    "duplicate_candidate" -> "候选池中已存在这个 Steam hashName"
    "pool_full" -> "候选池最多50项，请先删除一项"
    "unsupported_candidate" -> "请填准确名称，仅支持武器箱、胶囊和贴纸"
    "invalid_pool", "empty_pool" -> "候选清单为空或包含重复、无效商品"
    "response_too_large", "encoding" -> "来源响应过大或使用了暂不支持的编码"
    "http" -> "来源请求失败，本轮结果未通过校验"
    else -> "本次操作未完成，请重试"
}
fun notice(code: String) = when (code) {
    "credential_saved" -> "凭证已加密保存在本机"
    "credential_deleted" -> "凭证已删除"
    "fee_imported" -> "真实手续费观察核对通过，将用于下次扫描"
    "candidate_added" -> "商品已加入候选池"
    "scan_finished" -> "扫描完成，失败和未核验项已单独列出"
    else -> "操作完成"
}
