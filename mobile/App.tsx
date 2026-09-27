/**
 * CS2 余额助手 - 移动端入口
 * 底部 Tab（HANDOFF v2.0 第 14 节）：首页 / 市场 / 库存 / 雷达 / 我的。
 * 资金模拟不作为一级导航，作为工具入口（从首页进入，全屏覆盖）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { AppTabIcon, type AppTabIconName } from './src/components/AppTabIcon';
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

type TabKey = AppTabIconName;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'market', label: '市场' },
  { key: 'inventory', label: '库存' },
  { key: 'radar', label: '雷达' },
  { key: 'settings', label: '我的' },
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
        <StatusBar style="dark" />
        <View style={styles.bootstrap}>
          <Text style={styles.bootstrapText}>正在初始化本地数据…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (detailName) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <DetailScreen name={detailName} onBack={() => setDetailName(null)} />
      </SafeAreaProvider>
    );
  }

  const openDetail = (name: string) => setDetailName(name);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
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
        <AppTabBar tab={tab} onSelect={switchTab} />
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

function AppTabBar({ tab, onSelect }: { readonly tab: TabKey; readonly onSelect: (key: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorStretch = useRef(new Animated.Value(1)).current;
  const tabWidth = Math.max(0, (barWidth - 16) / TABS.length);

  useEffect(() => {
    if (tabWidth === 0) return;
    const target = TABS.findIndex((item) => item.key === tab) * tabWidth;
    Animated.parallel([
      Animated.timing(indicatorX, { toValue: target, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(indicatorStretch, { toValue: 1.2, duration: 100, useNativeDriver: true }),
        Animated.spring(indicatorStretch, { toValue: 1, friction: 8, tension: 120, useNativeDriver: true }),
      ]),
    ]).start();
  }, [indicatorStretch, indicatorX, tab, tabWidth]);

  return (
    <View
      style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
    >
      {tabWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.tabIndicator,
            { left: 8 + (tabWidth - 48) / 2, transform: [{ translateX: indicatorX }, { scaleX: indicatorStretch }] },
          ]}
        />
      ) : null}
      {TABS.map((item) => {
        const selected = tab === item.key;
        return (
          <TouchableOpacity
            key={item.key}
            style={styles.tabItem}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.76}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
          >
            <View style={styles.tabIconWrap}>
              <AppTabIcon name={item.key} selected={selected} />
            </View>
            <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
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
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  tabItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabIconWrap: { width: 48, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tabIndicator: { position: 'absolute', top: 14, width: 48, height: 29, borderRadius: 15, backgroundColor: colors.primarySoft },
  tabLabel: { color: colors.textDim, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg },
});
