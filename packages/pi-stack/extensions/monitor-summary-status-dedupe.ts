export interface MonitorSummaryStatusState {
  total: number;
  enabled: number;
  byEvent: Record<string, number>;
  classifyFailures: {
    total: number;
    byMonitor: Record<string, number>;
    lastMonitor?: string;
  };
}

function toSortedPairs(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
}

export function buildMonitorSummaryStatusSignature(summary: MonitorSummaryStatusState): string {
  return JSON.stringify({
    total: summary.total,
    enabled: summary.enabled,
    byEvent: toSortedPairs(summary.byEvent),
    classifyFailures: {
      total: summary.classifyFailures.total,
      byMonitor: toSortedPairs(summary.classifyFailures.byMonitor),
      lastMonitor: summary.classifyFailures.lastMonitor ?? null,
    },
  });
}

export function shouldEmitMonitorSummaryStatus(
  previousSignature: string | undefined,
  summary: MonitorSummaryStatusState,
): { emit: boolean; signature: string } {
  const signature = buildMonitorSummaryStatusSignature(summary);
  return { emit: signature !== previousSignature, signature };
}
