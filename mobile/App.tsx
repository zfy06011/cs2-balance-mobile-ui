/**
 * CS2 余额助手 - 移动端入口
 * 底部 Tab：首页 / 雷达 / 库存 / 模拟 / 设置
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors } from './src/theme/colors';
import { HomeScreen } from './src/screens/HomeScreen';
import { RadarScreen } from './src/screens/RadarScreen';
import { DetailScreen } from './src/screens/DetailScreen';
import { InventoryScreen } from './src/screens/InventoryScreen';
import { SimulateScreen } from './src/screens/SimulateScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type TabKey = 'home' | 'radar' | 'inventory' | 'simulate' | 'settings';

const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'home', icon: '🏠', label: '首页' },
  { key: 'radar', icon: '📡', label: '雷达' },
  { key: 'inventory', icon: '📦', label: '库存' },
  { key: 'simulate', icon: '💰', label: '模拟' },
  { key: 'settings', icon: '⚙️', label: '设置' },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [detailName, setDetailName] = useState<string | null>(null);

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
            <HomeScreen onOpenRadar={() => setTab('radar')} onOpenSimulate={() => setTab('simulate')} onOpenDetail={openDetail} />
          ) : null}
          {tab === 'radar' ? <RadarScreen onOpenDetail={openDetail} /> : null}
          {tab === 'inventory' ? <InventoryScreen /> : null}
          {tab === 'simulate' ? <SimulateScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)}>
              <Text style={styles.tabIcon}>{t.icon}</Text>
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
});
