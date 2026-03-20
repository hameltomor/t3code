import { useCallback, useEffect, useState } from "react";
import type {
  DashboardUsagePeriod,
  DashboardCloudSummary,
  DashboardUsageSummary,
  DashboardRateLimit,
  DashboardProviderStatus,
} from "@xbetools/contracts";
import { readNativeApi } from "~/nativeApi";

export interface DashboardData {
  usage: DashboardUsageSummary | null;
  cloud: DashboardCloudSummary | null;
  rateLimits: DashboardRateLimit[];
  providerStatus: DashboardProviderStatus[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDashboardData(period: DashboardUsagePeriod): DashboardData {
  const [usage, setUsage] = useState<DashboardUsageSummary | null>(null);
  const [cloud, setCloud] = useState<DashboardCloudSummary | null>(null);
  const [rateLimits, setRateLimits] = useState<DashboardRateLimit[]>([]);
  const [providerStatus, setProviderStatus] = useState<DashboardProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const api = readNativeApi();
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      const [usageResult, cloudResult, rateLimitsResult, providerStatusResult] = await Promise.all([
        api.dashboard.getUsageSummary({ period }),
        api.dashboard.getCloudSummary({ period }),
        api.dashboard.getRateLimits(),
        api.dashboard.getProviderStatus(),
      ]);
      setUsage(usageResult);
      setCloud(cloudResult);
      setRateLimits(rateLimitsResult);
      setProviderStatus(providerStatusResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { usage, cloud, rateLimits, providerStatus, loading, error, refresh: fetchData };
}
