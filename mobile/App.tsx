/**
 * CS2 余额助手 - 移动端入口
 * 底部 Tab（HANDOFF v2.0 第 14 节）：首页 / 市场 / 库存 / 雷达 / 我的。
 * 资金模拟不作为一级导航，作为工具入口（从首页进入，全屏覆盖）。
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { warmZhNames } from './src/data/zhNames';
import { attachScanLifecycle, scanService } from './src/data/scanService';
import { HomeScreen } from './src/screens/HomeScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { RadarScreen } from './src/screens/RadarScreen';
import { DetailScreen } from './src/screens/DetailScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { SimulateScreen } from './src/screens/SimulateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { CookieLoginScreen, CookieLoginKind } from './src/screens/CookieLoginScreen';

type TabKey = 'home' | 'market' | 'inventory' | 'radar' | 'settings';

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'home', icon: '🏠', label: '首页' },
  { key: 'market', icon: '🛒', label: '市场' },
  { key: 'inventory', icon: '📦', label: '库存' },
  { key: 'radar', icon: '📡', label: '雷达' },
  { key: 'settings', icon: '⚙️', label: '我的' },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [detailName, setDetailName] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [cookieLogin, setCookieLogin] = useState<CookieLoginKind | null>(null);
  const [histPull, setHistPull] = useState(false);
  // 登录弹窗关闭后强制重挂载设置页，让 cookie 方框立即刷新为已保存值
  const [settingsTick, setSettingsTick] = useState(0);

  // 启动即预热 Steam 官方中文名缓存（采集后会自动更新）
  useEffect(() => {
    warmZhNames().catch(() => undefined);
    scanService.restoreAndResume().catch(() => undefined);
    return attachScanLifecycle();
  }, []);

  if (detailName) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <DetailScreen name={detailName} onBack={() => setDetailName(null)} />
      </SafeAreaProvider>
    );
  }

  const openDetail = (name: string) => setDetailName(name);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.content}>
          {tab === 'home' ? (
            <HomeScreen
              onOpenMarket={() => setTab('market')}
              onOpenRadar={() => setTab('radar')}
              onOpenSimulate={() => setSimOpen(true)}
              onOpenDetail={openDetail}
              onOpenHistImport={() => setHistPull(true)}
            />
          ) : null}
          {tab === 'market' ? <MarketScreen onOpenDetail={openDetail} /> : null}
          {tab === 'radar' ? <RadarScreen onOpenDetail={openDetail} /> : null}
          {tab === 'inventory' ? <InventoryScreen /> : null}
          {tab === 'settings' ? <SettingsScreen key={settingsTick} onCookieLogin={setCookieLogin} /> : null}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)}>
              <Text style={styles.tabIcon}>{t.icon}</Text>
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {simOpen ? (
          <View style={styles.overlay}>
            <SimulateScreen onBack={() => setSimOpen(false)} />
          </View>
        ) : null}
        {cookieLogin ? (
          <View style={styles.overlay}>
            <CookieLoginScreen
              kind={cookieLogin}
              onClose={() => {
                setCookieLogin(null);
                setSettingsTick((t) => t + 1);
              }}
            />
          </View>
        ) : null}
        {histPull ? (
          <View style={styles.overlay}>
            <CookieLoginScreen kind="steam-hist" onClose={() => setHistPull(false)} />
          </View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIcon: { fontSize: 20 },
  tabLabel: { color: colors.textDim, fontSize: 11, marginTop: 2, fontWeight: '600' },
  tabLabelActive: { color: colors.primary },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg },
});
