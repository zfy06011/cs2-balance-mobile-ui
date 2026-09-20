/**
 * CS2 余额助手 - 移动端入口
 * 底部 Tab（HANDOFF v2.0 第 14 节）：首页 / 市场 / 库存 / 雷达 / 我的。
 * 资金模拟不作为一级导航，作为工具入口（从首页进入，全屏覆盖）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { warmZhNames } from './src/data/zhNames';
import { initStorage } from './src/data/migrate';
import { seedWebDemoData } from './src/data/webSeed';
import { attachScanLifecycle, scanService } from './src/data/scanService';
import { HomeScreen } from './src/screens/HomeScreen';
import { MarketScreen } from './src/screens/MarketScreen';
import { RadarScreen } from './src/screens/RadarScreen';
import { DetailScreen } from './src/screens/DetailScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { SimulateScreen } from './src/screens/SimulateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { CookieLoginScreen } from './src/screens/CookieLoginScreen';
import { QualificationScreen } from './src/screens/QualificationScreen';

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
  const [cookieLoginOpen, setCookieLoginOpen] = useState(false);
  const [qualificationOpen, setQualificationOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  // 登录弹窗关闭后强制重挂载设置页，让 cookie 方框立即刷新为已保存值
  const [settingsTick, setSettingsTick] = useState(0);
  // v1.8.4：切页淡入过渡（纯原生驱动，不阻塞 JS 线程）
  const fade = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;

  const switchTab = (next: TabKey) => {
    if (next === tab) return;
    setTab(next);
    fade.setValue(0);
    slide.setValue(6);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };

  useEffect(() => {
    (async () => {
      try {
        await initStorage();
        await seedWebDemoData();
        await warmZhNames();
      } finally {
        setStorageReady(true);
      }
      void scanService.restoreAndResume();
    })().catch(() => setStorageReady(true));
    return attachScanLifecycle();
  }, []);

  if (!storageReady) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" />
        <View style={styles.bootstrap}>
          <Text style={styles.bootstrapText}>正在初始化本地数据…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

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
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="light" />
      <View style={styles.root}>
        <Animated.View
          style={[
            styles.content,
            { opacity: fade, transform: [{ translateY: slide }] },
          ]}
        >
          {tab === 'home' ? (
            <HomeScreen
              onOpenSimulate={() => setSimOpen(true)}
              onOpenDetail={openDetail}
            />
          ) : null}
          {tab === 'market' ? <MarketScreen onOpenDetail={openDetail} /> : null}
          {tab === 'radar' ? <RadarScreen onOpenDetail={openDetail} /> : null}
          {tab === 'inventory' ? <InventoryScreen onOpenDetail={openDetail} /> : null}
          {tab === 'settings' ? (
            <SettingsScreen key={settingsTick} onCookieLogin={() => setCookieLoginOpen(true)} onOpenQualification={() => setQualificationOpen(true)} />
          ) : null}
        </Animated.View>
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => switchTab(t.key)}>
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
        {cookieLoginOpen ? (
          <View style={styles.overlay}>
            <CookieLoginScreen
              onClose={() => {
                setCookieLoginOpen(false);
                setSettingsTick((t) => t + 1);
              }}
            />
          </View>
        ) : null}
        {qualificationOpen ? (
          <View style={styles.overlay}>
            <QualificationScreen onBack={() => setQualificationOpen(false)} />
          </View>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bootstrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  bootstrapText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
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
