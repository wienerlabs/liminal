/**
 * LIMINAL — Analytics navigation bus
 *
 * WalletPanel ve ExecutionSummaryCard gibi component'ler AnalyticsPanel'in
 * aktif sekmesini dışarıdan değiştirebilmek için bu küçük pub/sub modülünü
 * kullanır. AnalyticsPanel mount olduğunda subscribe eder.
 */

export type AnalyticsTab = "live" | "history" | "protocol" | "leaders";

let currentTab: AnalyticsTab = "live";
const listeners = new Set<(tab: AnalyticsTab) => void>();

export function requestAnalyticsTab(tab: AnalyticsTab): void {
  currentTab = tab;
  listeners.forEach((fn) => fn(tab));
}

export function subscribeAnalyticsTab(
  fn: (tab: AnalyticsTab) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCurrentAnalyticsTab(): AnalyticsTab {
  return currentTab;
}
