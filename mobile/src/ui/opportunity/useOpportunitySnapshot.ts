import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { OpportunityMode } from '../../config/featureFlags';
import { peekProductionOpportunitySnapshot } from '../../data/opportunitySnapshot';
import type { ProductionOpportunitySnapshot } from '../../data/opportunityProduction';

export function useOpportunitySnapshot(mode?: OpportunityMode) {
  const [snapshot, setSnapshot] = useState<ProductionOpportunitySnapshot | null>(() => peekProductionOpportunitySnapshot(mode));
  const [loading, setLoading] = useState(() => peekProductionOpportunitySnapshot(mode) == null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveRefreshing, setLiveRefreshing] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const load = useCallback(async (force = false, candidateNames?: string[]) => {
    if (force) setRefreshing(true);
    try {
      const next = await api.productionOpportunity({ force, mode, candidateNames });
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '机会数据加载失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  const refreshLive = useCallback(async (candidateNames?: string[]) => {
    setLiveRefreshing(true);
    setLiveError(null);
    try {
      const next = await api.productionOpportunity({ force: true, mode, candidateNames });
      setSnapshot(next);
    } catch (cause) {
      setLiveError(cause instanceof Error ? cause.message : '实时盘口更新失败，当前仍显示本地结果');
    } finally {
      setLiveRefreshing(false);
    }
  }, [mode]);

  useEffect(() => {
    if (snapshot == null) void load();
  }, [load, snapshot]);

  return { snapshot, loading, refreshing, error, reload: load, refreshLive, liveRefreshing, liveError };
}
