/**
 * CookieLoginScreen：App 内一键登录 Steam / C5GAME，自动抓取登录 cookie。
 * 用户在内嵌 WebView 里正常登录（含验证码），登录凭证优先走原生 CookieManager
 * 读取（HttpOnly 的 steamLoginSecure 也能拿到）；原生读取失败或 JS 写入型 cookie
 * （如 C5 的 NC5_accessToken/NC5_uid）额外注入 document.cookie 兜底，
 * 命中即自动存入设置；另提供手动保存按钮。
 */
import React, { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { api } from '../api/client';
import { colors } from '../theme/colors';

export type CookieLoginKind = 'steam' | 'c5' | 'steam-hist';

const TARGETS: Record<
  CookieLoginKind,
  { title: string; url: string; origin: string; /** 登录成功的关键 cookie 名（命中即自动保存） */ loginCookie: RegExp }
> = {
  steam: {
    title: '登录 Steam',
    url: 'https://steamcommunity.com/login/home/',
    origin: 'https://steamcommunity.com',
    loginCookie: /steamloginsecure/i,
  },
  c5: {
    title: '登录 C5GAME',
    url: 'https://www.c5game.com/',
    origin: 'https://www.c5game.com',
    loginCookie: /NC5_accessToken|NC5_uid/i,
  },
  'steam-hist': {
    title: '🔁 快速导入历史（C5 官方趋势）',
    url: 'https://www.c5game.com/',
    origin: 'https://www.c5game.com',
    loginCookie: /NC5_accessToken|NC5_uid/i,
  },
};

interface Props {
  kind: CookieLoginKind;
  onClose: () => void;
}

export function CookieLoginScreen({ kind, onClose }: Props) {
  const target = TARGETS[kind];
  const isHistPull = kind === 'steam-hist';
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const checkedRef = useRef(false);
  const lastCheckRef = useRef(0);
  const waitingCookieRef = useRef<((body: string) => void) | null>(null);
  const webRef = useRef<React.ComponentRef<typeof WebView>>(null);

  // 库存同步已改为 Web API + 双 Context（syncSteamInventorySmart），不再使用页面直抓

  // 快速导入历史（C5 官方趋势）：借鉴 C5GAME 网页趋势接口
  // price-trend/chart，凭 C5 登录 Cookie 导入各箱 90 天历史（约 120 点）；
  // 任一件失败即停止并询问是否跳过继续，不再静默跳过。
  const histNamesRef = useRef<string[]>([]);
  const histStartedRef = useRef(false);
  const histResultRef = useRef({ ok: 0, fail: 0 });
  const histSnippetRef = useRef<string | null>(null);

  const startHistPull = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    setPullMsg('准备目标清单…');
    try {
      const settings = await api.getSettings();
      const c5AppKey = (settings.c5AppKey || '').trim();
      const c5Cookie = (settings.c5Cookie || '').trim();
      if (!c5Cookie) {
        setPulling(false);
        setPullMsg(null);
        Alert.alert(
          '需要 C5 登录凭证',
          '快速导入走 C5GAME 官方趋势接口（需 C5 登录态）。\n\n请在下方页面右上角登录 C5GAME（登录成功会自动保存凭证），然后再次点「开始导入」。',
        );
        return;
      }
      const names = await api.c5HistoryTargets(60);
      if (names.length === 0) {
        setPulling(false);
        setPullMsg(null);
        Alert.alert('没有需要导入的箱子', '所有监控箱子的历史都已充足（或还没有扫描数据）。');
        return;
      }
      histNamesRef.current = names;
      setPullMsg(`0/${names.length}`);
      let startIdx = 0;
      let acc = { ok: 0, skip: 0, fail: 0 };
      for (;;) {
        const r = await api.importC5Histories(
          names,
          { c5AppKey, c5Cookie },
          (done, total) => {
            setPullMsg(`${done}/${total}`); // done 为 1-based
          },
          startIdx,
        );
        acc = { ok: r.ok, skip: r.skip, fail: r.fail };
        if (r.failedIdx === null || r.failedIdx < 0) break; // 全部完成
        const cont = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '导入中断',
            `箱子：${r.failedName ?? '未知'}\n原因：${r.failedReason ?? '未知'}\n\n已成功 ${acc.ok} 个${acc.skip > 0 ? `，无新增 ${acc.skip} 个` : ''}${acc.fail > 0 ? `，失败 ${acc.fail} 个` : ''}。`,
            [
              { text: '停止', style: 'cancel', onPress: () => resolve(false) },
              { text: '跳过此箱继续', onPress: () => resolve(true) },
            ],
          );
        });
        if (!cont) break;
        startIdx = (r.failedIdx ?? 0) + 1;
      }
      setPulling(false);
      setPullMsg(null);
      if (acc.ok === 0 && acc.fail > 0 && acc.skip === 0) {
        Alert.alert(
          '导入 0 条',
          'C5 官方趋势接口全部失败。\n\n请确认 C5 Cookie 仍有效（可在页面右上角重新登录一次再试），或已正确配置 C5 app-key（可加快查 itemId）。',
        );
        return;
      }
      Alert.alert('历史导入完成 ✅', `成功 ${acc.ok} 个${acc.skip > 0 ? `，跳过 ${acc.skip} 个（无新增点数）` : ''}${acc.fail > 0 ? `，失败 ${acc.fail} 个` : ''}。返回后详情页即有完整趋势。`, [
        { text: '好的', onPress: onClose },
      ]);
    } catch (e) {
      setPulling(false);
      setPullMsg(null);
      Alert.alert('导入失败', e instanceof Error ? e.message : '未知错误');
    }
  }, [pulling, onClose]);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      let msg: { type?: string; steamId?: string; body?: string; error?: string; detail?: string; name?: string; prices?: unknown; snippet?: string | null; debug?: { assetCount?: number; descCount?: number; matchedPairs?: number } };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'cookie-dump' && typeof msg.body === 'string') {
        const resolver = waitingCookieRef.current;
        waitingCookieRef.current = null;
        if (resolver) resolver(msg.body);
        return;
      }
      if (isHistPull && msg.type === 'hist-item' && msg.name) {
        try {
          const r = await api.importSteamPriceHistoryRaw(msg.name, msg.prices ?? null);
          if (r.added > 0) histResultRef.current.ok++;
          else histResultRef.current.fail++;
        } catch {
          histResultRef.current.fail++;
        }
        if (msg.snippet && !histSnippetRef.current) histSnippetRef.current = String(msg.snippet);
        const total = histNamesRef.current.length || 1;
        setPullMsg(`${histResultRef.current.ok + histResultRef.current.fail}/${total}（成功 ${histResultRef.current.ok}）`);
        return;
      }
      if (isHistPull && msg.type === 'hist-done') {
        setPulling(false);
        const { ok, fail } = histResultRef.current;
        if (ok === 0) {
          setPullMsg(null);
          Alert.alert(
            '导入 0 条',
            `页面内拉取历史全部失败。\n\nSteam 原始返回片段：${histSnippetRef.current ?? '(无)'}\n\n` +
              '若片段包含登录页/空内容：请确认页面右上角已是登录状态；若始终如此，可能是 Steam 对该网络环境的限制，可尝试切换 VPN 节点。',
          );
          return;
        }
        Alert.alert('历史导入完成 ✅', `成功 ${ok} 个箱子${fail > 0 ? `，失败 ${fail} 个` : ''}。返回后详情页即有完整趋势。`, [
          { text: '好的', onPress: onClose },
        ]);
      }
    },
    [isHistPull, onClose],
  );

  const save = useCallback(
    async (header: string) => {
      if (!header || !header.trim()) {
        Alert.alert('未获取到登录信息', '请确认已在页面内登录成功后再保存。');
        return;
      }
      setSaving(true);
      try {
        if (kind === 'steam') {
          await api.updateSettings({ steamCookie: header });
        } else {
          await api.updateSettings({ c5Cookie: header });
        }
        setSaved(true);
        Alert.alert('登录成功 ✅', `${target.title}的登录凭证已保存，采集时会自动使用。`, [{ text: '好的', onPress: onClose }]);
      } catch (e) {
        Alert.alert('保存失败', e instanceof Error ? e.message : '未知错误');
      } finally {
        setSaving(false);
      }
    },
    [kind, onClose, target.title],
  );

  /** 判断 cookie 头是否已含登录态（Steam=steamLoginSecure，C5=NC5_accessToken/NC5_uid） */
  const hasLoginCookie = useCallback(
    (header: string | null | undefined): boolean => {
      if (!header || !header.trim()) return false;
      if (kind === 'c5' || kind === 'steam-hist') {
        return /NC5_accessToken|NC5_uid/i.test(header) || /token|passport|session|uid/i.test(header);
      }
      return /steamloginsecure\s*=/i.test(header);
    },
    [kind],
  );

  /** WebView 注入 document.cookie 读取 JS 可读 cookie（C5 的 NC5_* 由前端 JS 写入，原生读取兜不住时用它） */
  const readCookiesViaJs = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!webRef.current) {
        resolve(null);
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          waitingCookieRef.current = null;
          resolve(null);
        }
      }, 2500);
      waitingCookieRef.current = (body: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(body && body.trim() ? body : null);
      };
      webRef.current.injectJavaScript(
        `(function(){ try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'cookie-dump', body: document.cookie || ''})); } catch(e) { window.ReactNativeWebView.postMessage(JSON.stringify({type:'cookie-dump', body: ''})); } })();true;`,
      );
    });
  }, []);

  /** 每次页面跳转/加载完成都检查一次关键 cookie，命中即自动保存（用户无感） */
  const checkAndSave = useCallback(async () => {
    if (checkedRef.current || saved || saving) return;
    const now = Date.now();
    if (now - lastCheckRef.current < 2500) return; // 防抖：登录跳转链会连续触发多次
    lastCheckRef.current = now;
    let header: string | null = null;
    try {
      header = await CookieManager.getCookieHeader(target.origin);
    } catch {
      header = null; // 原生读取不可用时走 JS 兜底
    }
    if (!hasLoginCookie(header)) {
      header = await readCookiesViaJs();
    }
    if (header && hasLoginCookie(header)) {
      checkedRef.current = true;
      await save(header);
    }
  }, [save, saved, saving, target.origin, hasLoginCookie, readCookiesViaJs]);

  const onNav = (nav: WebViewNavigation) => {
    if (nav.url.startsWith(target.origin)) {
      checkAndSave();
    }
  };

  const manualSave = async () => {
    if (isHistPull) {
      startHistPull();
      return;
    }
    let header: string | null = null;
    try {
      header = await CookieManager.getCookieHeader(target.origin);
    } catch {
      header = null;
    }
    if (!hasLoginCookie(header)) {
      header = await readCookiesViaJs();
    }
    if (!header || !hasLoginCookie(header)) {
      Alert.alert(
        '未检测到登录凭证',
        '当前页面未检测到登录 cookie（可能为空、未登录或已过期）。请确认页面已是登录状态后重试；仍不行可回到设置页手动粘贴 cookie。',
      );
      return;
    }
    await save(header);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.close}>✕ 关闭</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{target.title}</Text>
        <TouchableOpacity onPress={manualSave} disabled={saving || saved || (pulling && !isHistPull)}>
          <Text style={[styles.save, (saving || saved || pulling) && { opacity: 0.6 }]}>
            {isHistPull
              ? pulling
                ? `导入中 ${pullMsg ?? ''}`
                : '开始导入'
              : saved
                ? '已保存'
                : '手动保存'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        {isHistPull
          ? '借鉴 C5GAME 官方网页趋势接口，快速导入各箱 90 天历史（约 120 个价格点）。先在页面右上角登录 C5GAME（自动保存凭证），再点「开始导入」；任一件失败会停下来询问，不再静默跳过。'
          : '在页面内正常登录（支持验证码）；登录成功后会自动保存，也可点右上角「手动保存」。'}
      </Text>
      <WebView
        ref={webRef}
        source={{ uri: target.url }}
        onNavigationStateChange={onNav}
        onLoadEnd={isHistPull ? undefined : checkAndSave}
        onMessage={onMessage}
        startInLoadingState
        thirdPartyCookiesEnabled
        domStorageEnabled
        sharedCookiesEnabled
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.card,
  },
  close: { color: colors.textDim, fontSize: 14 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  save: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 11, paddingHorizontal: 14, paddingVertical: 6 },
});
