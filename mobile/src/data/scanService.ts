/**
 * scanService：全局扫描状态单例。
 * - 进度不挂在页面上：切 Tab / 返回首页进度照常显示
 * - 退到后台：进程存活时采集循环自动继续；回到前台刷新展示
 * - 进程被杀：下次启动从持久化状态恢复，30 分钟内自动续扫
 *   （collectCases 的 15 分钟跳过逻辑保证只补缺失项，不会从头来）
 */
import { AppState } from 'react-native';
import { storage, ScanStateRecord } from './storage';
import { collectCases, CollectStats } from './collector';
import { clearDetailCache } from '../core/detailCache';
import { bumpAnalysisGeneration } from '../core/analysisCache';

export interface ScanState {
  running: boolean;
  progress: ScanStateRecord['progress'];
  startedAt: string | null;
  count: number;
}

const RESUME_WINDOW_MS = 30 * 60 * 1000;

let state: ScanState = { running: false, progress: null, startedAt: null, count: 0 };
const listeners = new Set<(s: ScanState) => void>();
let startedHere = false; // 本进程内主动发起的扫描（结束时清 running）

function notify(): void {
  for (const l of listeners) {
    try {
      l({ ...state });
    } catch {
      // 单个订阅者异常不影响其他
    }
  }
}

function toRecord(): ScanStateRecord {
  return { running: state.running, progress: state.progress, startedAt: state.startedAt, count: state.count };
}

async function persist(): Promise<void> {
  try {
    await storage.saveScanState(toRecord());
  } catch {
    // 持久化失败不影响扫描
  }
}

export const scanService = {
  getState(): ScanState {
    return { ...state };
  },

  subscribe(l: (s: ScanState) => void): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /** App 启动时调用：恢复上次扫描展示；30 分钟内未完成的自动续扫 */
  async restoreAndResume(): Promise<void> {
    if (state.running) return;
    try {
      const s = await storage.getScanState();
      if (s && s.startedAt) {
        state = {
          running: false,
          progress: s.progress,
          startedAt: s.startedAt,
          count: s.count,
        };
        notify();
        const fresh = Date.now() - new Date(s.startedAt).getTime() < RESUME_WINDOW_MS;
        const incomplete = !s.progress || s.progress.stage !== 'done' || (s.progress && s.progress.done < s.progress.total);
        if (fresh && incomplete && s.count > 0) {
          await this.start(s.count, true);
        }
      }
    } catch {
      // 恢复失败按无历史处理
    }
  },

  /** 回到前台：进程存活时后台被冻结的循环会自行恢复，这里刷新通知；进程已死则由启动时的 restoreAndResume 处理 */
  onAppActive(): void {
    notify();
  },

  /** 发起扫描；已在进行中时抛错。auto=true 表示断点续扫 */
  async start(count: number, auto = false): Promise<CollectStats> {
    if (state.running && startedHere) {
      throw new Error('扫描进行中，请稍候');
    }
    startedHere = true;
    state = { running: true, progress: auto ? state.progress : null, startedAt: state.startedAt ?? new Date().toISOString(), count };
    if (!auto) state.startedAt = new Date().toISOString();
    notify();
    await persist();
    try {
      const stats = await collectCases({
        count,
        onProgress: (p) => {
          state = { ...state, progress: p };
          notify();
          persist();
        },
      });
      clearDetailCache();
      bumpAnalysisGeneration();
      return stats;
    } finally {
      startedHere = false;
      state = { ...state, running: false };
      notify();
      await persist();
    }
  },
};

/** App 挂载时接好前后台监听（在 App.tsx 调一次） */
export function attachScanLifecycle(): () => void {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') scanService.onAppActive();
  });
  return () => sub.remove();
}
