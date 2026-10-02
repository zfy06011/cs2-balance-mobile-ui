package com.cs2balance.assistant.mvp.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cs2balance.assistant.mvp.AppState
import com.cs2balance.assistant.mvp.BalanceViewModel
import com.cs2balance.assistant.mvp.domain.AppCache
import com.cs2balance.assistant.mvp.domain.Candidate
import com.cs2balance.assistant.mvp.domain.Comparison
import com.cs2balance.assistant.mvp.domain.Money
import com.cs2balance.assistant.mvp.domain.Quote

private data class Destination(val id: String, val title: String, val icon: ImageVector)
private val destinations = listOf(Destination("ranking", "排行", Icons.Filled.BarChart),
    Destination("pool", "候选池", Icons.Filled.Inventory2), Destination("settings", "设置", Icons.Filled.Settings))

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun BalanceApp(model: BalanceViewModel) {
    val state by model.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf("ranking") }
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val rankingScroll = rememberLazyListState(); val poolScroll = rememberLazyListState()
    BackHandler(detailId != null) { detailId = null }
    LaunchedEffect(state.error, state.notice) {
        val message = state.error?.let(::reason) ?: state.notice?.let(::notice)
        if (message != null) { snackbar.showSnackbar(message); model.dismissMessage() }
    }
    val locked = state.loading || state.busy || state.scanning
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(if (detailId != null) "商品比价" else destinations.first { it.id == tab }.title) },
                navigationIcon = {
                    if (detailId != null) IconButton(onClick = { detailId = null }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回列表")
                    }
                })
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (detailId == null) Column {
                if (tab == "ranking") Button(onClick = { model.startScan() },
                    enabled = !locked && !state.cache?.candidates.isNullOrEmpty(),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Space.medium, vertical = Space.small)) {
                    if (state.scanning) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.size(Space.small))
                    }
                    Text(if (state.scanning) "正在扫描" else "开始扫描")
                }
                NavigationBar {
                    destinations.forEach { entry -> NavigationBarItem(selected = tab == entry.id,
                        onClick = { tab = entry.id }, icon = { Icon(entry.icon, null) }, label = { Text(entry.title) }) }
                }
            }
        },
    ) { insets ->
        Box(Modifier.fillMaxSize().padding(insets), contentAlignment = Alignment.TopCenter) {
            val cache = state.cache
            if (state.loading) CircularProgressIndicator(Modifier.padding(Space.huge))
            else if (detailId != null && cache != null) {
                val candidate = cache.candidates.firstOrNull { it.id == detailId }
                if (candidate != null) Detail(candidate, cache, locked, state.scanning,
                    onRefresh = { model.startScan(candidate.id) })
                else EmptyMessage("商品已移出候选池", "返回列表查看其他商品。")
            } else when (tab) {
                "pool" -> Pool(state, model, poolScroll, onDetail = { detailId = it })
                "settings" -> Settings(state, model)
                else -> Ranking(state, rankingScroll, onDetail = { detailId = it },
                    onSettings = { tab = "settings" }, onPool = { tab = "pool" }, onRetry = { model.startScan(it) })
            }
        }
    }
}

@Composable private fun Ranking(state: AppState, listState: LazyListState, onDetail: (String) -> Unit,
    onSettings: () -> Unit, onPool: () -> Unit, onRetry: (String) -> Unit) {
    val cache = state.cache
    val active = cache?.candidates?.map { it.id }?.toSet().orEmpty()
    val rows = cache?.latest?.rows.orEmpty().filter { it.item.id in active }
    val ranking = Money.rank(rows)
    val failures = rows.filterNot { it.rankable }
    val rankedIds = ranking.map { it.item.id }.toSet()
    val old = cache?.completeResults?.values.orEmpty().filter { it.item.id in active && it.item.id !in rankedIds }
    LazyColumn(state = listState, modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth(),
        contentPadding = PaddingValues(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.medium)) {
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(Space.large), verticalArrangement = Arrangement.spacedBy(Space.small)) {
                    Text("获得 100 元 Steam 余额", style = MaterialTheme.typography.titleLarge)
                    Text("按所需现金从低到高排列", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("当前挂单估算；不证明可成交或等待后价格。", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (cache == null) item { EmptyMessage("本地数据暂不可用", "原数据已保留。请检查存储后重新打开应用。") }
        else {
            if (!state.credentialConfigured) item {
                ActionMessage("先配置数据来源", "保存新的 C5 app-key 后，才能取得双平台报价。", "前往设置", onSettings)
            }
            if (cache.feeProfile?.verified != true) item {
                ActionMessage("手续费待核验", "扫描可查看来源报价；导入真实观察核对前，商品不会加入排行。", "导入手续费观察", onSettings)
            }
            item {
                val latest = cache.latest
                val status = when {
                    state.scanning -> "扫描中 ${latest?.rows?.size ?: 0}/${latest?.itemsRequested ?: cache.candidates.size}"
                    latest == null -> "尚未扫描 · ${cache.candidates.size} 个候选"
                    latest.completedAt == null -> "上次扫描未完成 · ${latest.rows.size}/${latest.itemsRequested}"
                    else -> "上次扫描 ${time(latest.completedAt)}"
                }
                Column(verticalArrangement = Arrangement.spacedBy(Space.small)) {
                    Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (state.scanning) LinearProgressIndicator(progress = {
                        (latest?.rows?.size ?: 0).toFloat() / maxOf(latest?.itemsRequested ?: 1, 1)
                    }, modifier = Modifier.fillMaxWidth())
                    cache.cooldowns.filterValues { it > System.currentTimeMillis() }.forEach { (source, until) ->
                        Text("${if (source == "c5") "C5" else "Steam"} 冷却至 ${time(java.time.Instant.ofEpochMilli(until).toString())}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            if (cache.candidates.isEmpty()) item {
                ActionMessage("候选池为空", "加入武器箱、胶囊或贴纸后开始扫描。", "管理候选池", onPool)
            }
            else if (ranking.isEmpty()) item {
                EmptyMessage("暂无本轮有效排行", if (state.scanning) "结果将逐项显示。" else "点击开始扫描；未核验和失败项会单独列出。")
            }
            if (ranking.isNotEmpty()) item { SectionTitle("本轮有效结果 · ${ranking.size}") }
            items(ranking, key = { "rank:${it.item.id}" }) { row -> ResultCard(row, onClick = { onDetail(row.item.id) }) }
            if (failures.isNotEmpty()) item { SectionTitle("本轮失败或待核验 · ${failures.size}") }
            items(failures, key = { "failure:${it.item.id}" }) { row ->
                OutlinedCard(onClick = { onDetail(row.item.id) }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
                        Text(row.item.displayName, style = MaterialTheme.typography.titleMedium)
                        Text(reason(row.reason), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("C5 ${money(row.c5.amountCents)} · Steam ${money(row.steam.amountCents)}",
                            style = MaterialTheme.typography.bodySmall)
                        cache.completeResults[row.item.id]?.let { prior ->
                            Text("已保留上次完整结果 · ${time(prior.steam.collectedAt)}", style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton(onClick = { onRetry(row.item.id) }, enabled = !state.scanning && !state.busy) { Text("单项重试") }
                    }
                }
            }
            if (old.isNotEmpty()) item {
                SectionTitle("上次完整结果 · 不计入本轮排行")
            }
            items(old.sortedBy { it.item.id }, key = { "old:${it.item.id}" }) { row ->
                ResultCard(row, historical = true, onClick = { onDetail(row.item.id) })
            }
        }
    }
}

@Composable private fun ResultCard(row: Comparison, historical: Boolean = false, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.item.displayName, style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Icon(Icons.Filled.ChevronRight, null)
            }
            Text(if (historical) "上次估算所需现金" else "每100元余额所需现金", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(money(row.cashPer100Cny?.displayCents), style = MaterialTheme.typography.headlineMedium.copy(fontFeatureSettings = "tnum"),
                fontWeight = FontWeight.SemiBold, color = if (historical) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary)
            Text("C5 ${money(row.c5.amountCents)} · Steam 净到账 ${money(row.fee?.netCents)}",
                style = MaterialTheme.typography.bodySmall)
            Text("${if (historical) "旧结果" else "采集"} · ${time(row.steam.collectedAt)}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable private fun Detail(item: Candidate, cache: AppCache, locked: Boolean, scanning: Boolean, onRefresh: () -> Unit) {
    val current = cache.latest?.rows?.firstOrNull { it.item.id == item.id }
    val prior = cache.completeResults[item.id]?.takeIf { it.batchId != current?.batchId }
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.large)) {
        Text(item.displayName, style = MaterialTheme.typography.headlineSmall)
        Text("${category(item.category)} · ${item.steamHashName}", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("C5 ID：${current?.item?.c5ItemId ?: item.c5ItemId ?: "待验证"}", style = MaterialTheme.typography.bodySmall)
        SectionTitle("本轮报价")
        if (current == null) EmptyMessage("本轮还未取得此商品结果", "刷新会独立采集两侧报价。")
        else {
            QuoteDetail("C5 单件最低在售价", current.c5)
            QuoteDetail("Steam 单件买家支付总额", current.steam)
            if (current.rankable) FeeDetail(current) else Text(reason(current.reason), color = MaterialTheme.colorScheme.error)
        }
        Button(onClick = onRefresh, enabled = !locked, modifier = Modifier.fillMaxWidth()) {
            if (scanning) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.size(Space.small))
            }
            Text(if (scanning) "正在采集" else "刷新此商品")
        }
        if (prior != null) {
            HorizontalDivider()
            SectionTitle("上次完整结果 · 未与本轮报价合并")
            QuoteDetail("上次 C5 单件价", prior.c5)
            QuoteDetail("上次 Steam 买家总额", prior.steam)
            FeeDetail(prior)
        }
        Text("结果来自当前最低挂单，未计入价格变化或卖出等待。交易保护期与账户可售时间需自行核对。",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun QuoteDetail(label: String, quote: Quote) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            Text(money(quote.amountCents), style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"))
            Text("币种 ${quote.currency} · ${time(quote.collectedAt)}", style = MaterialTheme.typography.bodySmall)
            if (quote.status != "success") Text(reason(quote.failure), color = MaterialTheme.colorScheme.error)
        }
    }
}
@Composable private fun FeeDetail(row: Comparison) {
    val fee = row.fee ?: return
    Column(verticalArrangement = Arrangement.spacedBy(Space.small)) {
        Text("Steam 交易费 ${money(fee.steamFeeCents)} · CS2 游戏费 ${money(fee.publisherFeeCents)}",
            style = MaterialTheme.typography.bodyMedium)
        Text("卖家净到账 ${money(fee.netCents)}", style = MaterialTheme.typography.titleMedium)
        Text("每100元余额所需现金 ${money(row.cashPer100Cny?.displayCents)}",
            style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable private fun Pool(state: AppState, model: BalanceViewModel, listState: LazyListState, onDetail: (String) -> Unit) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Candidate?>(null) }
    val candidates = state.cache?.candidates.orEmpty()
    val locked = state.loading || state.scanning || state.busy || state.cache == null
    LazyColumn(state = listState, modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth(),
        contentPadding = PaddingValues(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(Space.medium)) {
                Text("${candidates.size}/50 个商品", style = MaterialTheme.typography.headlineSmall)
                Text("仅支持武器箱、胶囊和贴纸。内置名称与在售状态待真实接口核对。",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FilledTonalButton(onClick = { adding = true }, enabled = !locked && candidates.size < 50) {
                    Icon(Icons.Filled.Add, null); Spacer(Modifier.size(Space.small)); Text("添加商品")
                }
                if (state.scanning) Text("扫描期间暂不能编辑，当前批次使用启动时的清单。", style = MaterialTheme.typography.bodySmall)
            }
        }
        if (candidates.isEmpty()) item { EmptyMessage("还没有候选商品", "添加准确的 Steam market hashName。") }
        items(candidates, key = { it.id }) { candidate ->
            OutlinedCard(onClick = { onDetail(candidate.id) }, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(start = Space.medium, top = Space.small, bottom = Space.small),
                    verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.small)) {
                        Text(candidate.displayName, style = MaterialTheme.typography.titleMedium)
                        Text("${category(candidate.category)} · ${candidate.steamHashName}", maxLines = 2,
                            overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { deleting = candidate }, enabled = !locked) {
                        Icon(Icons.Filled.DeleteOutline, "删除${candidate.displayName}")
                    }
                }
            }
        }
    }
    if (adding) AddCandidateDialog(onDismiss = { adding = false }, onAdd = { cat, name, hash ->
        model.addCandidate(cat, name, hash); adding = false
    })
    deleting?.let { item -> AlertDialog(onDismissRequest = { deleting = null },
        title = { Text("移出候选池？") }, text = { Text(item.displayName) },
        confirmButton = { TextButton(onClick = { model.removeCandidate(item.id); deleting = null }, enabled = !locked) { Text("移出") } },
        dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun AddCandidateDialog(onDismiss: () -> Unit, onAdd: (String, String, String) -> Unit) {
    var selected by rememberSaveable { mutableStateOf("case") }
    var label by rememberSaveable { mutableStateOf("") }; var hash by rememberSaveable { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("添加候选商品") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Space.small)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.small)) {
                listOf("case", "capsule", "sticker").forEach { value ->
                    FilterChip(selected = selected == value, onClick = { selected = value }, label = { Text(category(value)) })
                }
            }
            OutlinedTextField(value = label, onValueChange = { label = it.take(120) }, label = { Text("显示名称") }, singleLine = true)
            OutlinedTextField(value = hash, onValueChange = { hash = it.take(200) }, label = { Text("Steam market hashName") },
                supportingText = { Text("准确英文标识，例如 Revolution Case") }, singleLine = true)
        }
    }, confirmButton = { TextButton(onClick = { onAdd(selected, label, hash) }, enabled = label.isNotBlank() && hash.isNotBlank()) { Text("添加") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } })
}

@Composable private fun Settings(state: AppState, model: BalanceViewModel) {
    // Credentials intentionally use remember, never rememberSaveable or AppState.
    var key by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
    val locked = state.loading || state.scanning || state.busy
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) model.importFees(uri)
    }
    LaunchedEffect(state.notice) { if (state.notice == "credential_saved") key = "" }
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.large)) {
        SectionTitle("C5 数据来源")
        Text(when {
            state.credentialProblem -> "凭证读取失败，可重新保存或删除"
            state.credentialConfigured -> "已保存凭证"
            else -> "尚未保存凭证"
        }, style = MaterialTheme.typography.titleMedium)
        Text("凭证仅加密保存在本机。接口权限、价格单位与手机网络可用性仍需实际验证。",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(value = key, onValueChange = { key = it.take(256) }, modifier = Modifier.fillMaxWidth(),
            enabled = !locked, label = { Text("新的 C5 app-key") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Button(onClick = { model.saveCredential(key) }, enabled = !locked && key.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("保存凭证") }
        if (state.credentialConfigured || state.credentialProblem) OutlinedButton(onClick = { deleting = true }, enabled = !locked) { Text("删除凭证") }
        HorizontalDivider()
        SectionTitle("Steam 人民币手续费")
        val profile = state.cache?.feeProfile
        Text(if (profile?.verified == true) "已核对 ${profile.count} 项真实观察 · ${time(profile.observedAt)}" else "尚未核验，排行保持为空",
            style = MaterialTheme.typography.titleMedium)
        Text("在 Steam 人民币卖出对话框观察金额即可，无需提交交易。记录至少六个不同净到账金额，包含低价、费用边界和100元净到账；按观察模板保存 JSON 后导入核对。",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FilledTonalButton(onClick = { importer.launch(arrayOf("application/json", "text/plain")) },
            enabled = !locked && state.cache != null, modifier = Modifier.fillMaxWidth()) { Text("导入实际手续费观察") }
        HorizontalDivider()
        Text("宇额助手 · 开发版 0.1.0", style = MaterialTheme.typography.titleSmall)
        Text("打开先读本地缓存；只在你手动扫描或刷新时采集。此版本不自动买卖，也不包含服务器、库存、预测和后台提醒。",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("删除本机 C5 凭证？") },
        text = { Text("缓存报价会保留。下次采集前需重新保存凭证。") },
        confirmButton = { TextButton(onClick = { key = ""; model.deleteCredential(); deleting = false }, enabled = !locked) { Text("删除") } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } })
}

@Composable private fun SectionTitle(value: String) {
    Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}
@Composable private fun EmptyMessage(title: String, description: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
@Composable private fun ActionMessage(title: String, description: String, action: String, onClick: () -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(Space.medium), verticalArrangement = Arrangement.spacedBy(Space.small)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onClick) { Text(action) }
        }
    }
}
