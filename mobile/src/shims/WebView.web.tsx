/**
 * WebView.web.tsx —— Web 端打桩（v1.8.6-web）。
 *
 * react-native-webview 是原生模块，浏览器里没有等价实现。
 * 网页调试不需要真的内嵌 Steam 登录页，这里渲染一个提示框，
 * 保证 CookieLoginScreen 能正常显示、不因缺原生模块而崩。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export type WebViewMessageEvent = { nativeEvent: { data: string } };
export type WebViewNavigation = { url: string };

interface Props {
  source?: { uri?: string; html?: string };
  onMessage?: (e: WebViewMessageEvent) => void;
  onLoadEnd?: () => void;
  onNavigationStateChange?: (nav: WebViewNavigation) => void;
  injectedJavaScript?: string;
  style?: unknown;
  [key: string]: unknown;
}

export default function WebView({ style }: Props) {
  return (
    <View style={[styles.box, style as never]}>
      <Text style={styles.title}>Web 调试模式</Text>
      <Text style={styles.desc}>
        内嵌浏览器（WebView）只在手机 App 中可用。{'\n'}
        网页版仅供界面调试，登录功能请在手机上使用。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.cardAlt,
    borderRadius: 12,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  desc: { color: colors.textDim, fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
