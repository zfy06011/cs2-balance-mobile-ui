/**
 * CookieLoginScreen：App 内一键登录 Steam，自动抓取登录 cookie。
 * 用户在内嵌 WebView 里正常登录（含验证码），登录凭证优先走原生 CookieManager
 * 读取（HttpOnly 的 steamLoginSecure 也能拿到）；原生读取失败时额外注入
 * document.cookie 兜底，命中即自动存入设置；另提供手动保存按钮。
 *
 * Steam 登录的用途：提高搜索榜返回数量、自动识别本人 SteamID64。
 * 库存与买入价均走 C5 app-key，不依赖任何 cookie。
 */
import React, { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { api } from '../api/client';
import { colors } from '../theme/colors';

const TARGET = {
  title: '登录 Steam',
  url: 'https://steamcommunity.com/login/home/',
  origin: 'https://steamcommunity.com',
  /** 登录成功的关键 cookie 名（命中即自动保存） */
  loginCookie: /steamloginsecure/i,
};

interface Props {
  onClose: () => void;
}

export function CookieLoginScreen({ onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const checkedRef = useRef(false);
  const lastCheckRef = useRef(0);
  const waitingCookieRef = useRef<((body: string) => void) | null>(null);
  const webRef = useRef<React.ComponentRef<typeof WebView>>(null);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: { type?: string; body?: string };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'cookie-dump' && typeof msg.body === 'string') {
      const resolver = waitingCookieRef.current;
      waitingCookieRef.current = null;
      if (resolver) resolver(msg.body);
    }
  }, []);

  const save = useCallback(
    async (header: string) => {
      if (!header || !header.trim()) {
        Alert.alert('未获取到登录信息', '请确认已在页面内登录成功后再保存。');
        return;
      }
      setSaving(true);
      try {
        await api.updateSettings({ steamCookie: header });
        setSaved(true);
        Alert.alert('登录成功 ✅', `${TARGET.title}的登录凭证已保存，采集时会自动使用。`, [{ text: '好的', onPress: onClose }]);
      } catch (e) {
        Alert.alert('保存失败', e instanceof Error ? e.message : '未知错误');
      } finally {
        setSaving(false);
      }
    },
    [onClose],
  );

  /** 判断 cookie 头是否已含 Steam 登录态 */
  const hasLoginCookie = useCallback((header: string | null | undefined): boolean => {
    if (!header || !header.trim()) return false;
    return /steamloginsecure\s*=/i.test(header);
  }, []);

  /** WebView 注入 document.cookie 读取 JS 可读 cookie（原生读取兜不住时用它） */
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
      header = await CookieManager.getCookieHeader(TARGET.origin);
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
  }, [save, saved, saving, hasLoginCookie, readCookiesViaJs]);

  const onNav = (nav: WebViewNavigation) => {
    if (nav.url.startsWith(TARGET.origin)) {
      checkAndSave();
    }
  };

  const manualSave = async () => {
    let header: string | null = null;
    try {
      header = await CookieManager.getCookieHeader(TARGET.origin);
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
        <Text style={styles.title}>{TARGET.title}</Text>
        <TouchableOpacity onPress={manualSave} disabled={saving || saved}>
          <Text style={[styles.save, (saving || saved) && { opacity: 0.6 }]}>
            {saved ? '已保存' : '手动保存'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>
        在页面内正常登录（支持验证码）；登录成功后会自动保存，也可点右上角「手动保存」。
      </Text>
      <WebView
        ref={webRef}
        source={{ uri: TARGET.url }}
        onNavigationStateChange={onNav}
        onLoadEnd={checkAndSave}
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
