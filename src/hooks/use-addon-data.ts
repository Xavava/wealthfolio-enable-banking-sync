import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account, AddonContext } from '@wealthfolio/addon-sdk';
import { createContext, useContext } from 'react';
import { EnableBankingClient, PRIVATE_KEY_SECRET } from '../lib/enable-banking-client';
import type { EbApplication } from '../lib/eb-types';
import { store, type AddonConfig, type BankConnection, type PendingAuthorization, type SyncReport } from '../lib/state';

export const AddonCtx = createContext<AddonContext | null>(null);

export function useAddonCtx(): AddonContext {
  const ctx = useContext(AddonCtx);
  if (!ctx) throw new Error('AddonCtx missing');
  return ctx;
}

export const QK = {
  state: ['enable-banking-sync', 'state'] as const,
  application: (applicationId: string) => ['enable-banking-sync', 'application', applicationId] as const,
  aspsps: (applicationId: string, country: string) =>
    ['enable-banking-sync', 'aspsps', applicationId, country] as const,
  wfAccounts: ['enable-banking-sync', 'wealthfolio-accounts'] as const,
};

export interface AddonState {
  config: AddonConfig;
  connections: BankConnection[];
  pending: PendingAuthorization | null;
  lastReport: SyncReport | null;
  hasPrivateKey: boolean;
}

export function useAddonState() {
  const ctx = useAddonCtx();
  return useQuery<AddonState>({
    queryKey: QK.state,
    queryFn: async () => {
      const storage = ctx.api.storage;
      const [config, connections, pending, lastReport, key] = await Promise.all([
        store.loadConfig(storage),
        store.loadConnections(storage),
        store.loadPending(storage),
        store.loadLastReport(storage),
        ctx.api.secrets.get(PRIVATE_KEY_SECRET).catch(() => null),
      ]);
      return { config, connections, pending, lastReport, hasPrivateKey: Boolean(key) };
    },
    staleTime: Infinity,
  });
}

export function isConfigured(state?: AddonState): boolean {
  return Boolean(state?.config.applicationId && state.hasPrivateKey);
}

export function useClient(state?: AddonState): EnableBankingClient | null {
  const ctx = useAddonCtx();
  if (!state || !isConfigured(state)) return null;
  return new EnableBankingClient(ctx.api, state.config.applicationId);
}

export function useApplication(state?: AddonState) {
  const client = useClient(state);
  return useQuery<EbApplication>({
    queryKey: QK.application(state?.config.applicationId ?? ''),
    queryFn: () => client!.getApplication(),
    enabled: Boolean(client),
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useWealthfolioAccounts() {
  const ctx = useAddonCtx();
  return useQuery<Account[]>({
    queryKey: QK.wfAccounts,
    queryFn: () => ctx.api.accounts.getAll(),
    staleTime: 60 * 1000,
  });
}

/** Persists connections and refreshes the cached add-on state. */
export function useSaveConnections() {
  const ctx = useAddonCtx();
  const queryClient = useQueryClient();
  return async (connections: BankConnection[]) => {
    await store.saveConnections(ctx.api.storage, connections);
    queryClient.setQueryData<AddonState>(QK.state, (old) => (old ? { ...old, connections } : old));
  };
}
