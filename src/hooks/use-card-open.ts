import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { store, type UiPrefs } from '../lib/state';
import { QK, useAddonCtx } from './use-addon-data';

export type CardId = 'sync' | 'connections' | 'connect' | 'settings';

export interface CardOpenOptions {
  /** Open the first time, before the user folds or unfolds the card. */
  defaultOpen: boolean;
  /** Something in the card needs the user: open it on load and whenever this turns true. */
  attention: boolean;
  /** Any change of this value opens the card (e.g. a sync just started). */
  openSignal?: number;
}

/**
 * Open/folded state of a card. The user's choice is remembered in the add-on's
 * storage (browser storage is blocked in the sandbox), but a card that needs
 * attention opens by itself: when the page opens or when the need appears.
 */
export function useCardOpen(id: CardId, options: CardOpenOptions): [boolean, (open: boolean) => void] {
  const ctx = useAddonCtx();
  const queryClient = useQueryClient();
  const prefs = useQuery<UiPrefs>({
    queryKey: QK.ui,
    queryFn: () => store.loadUi(ctx.api.storage),
    staleTime: Infinity,
  });
  const [open, setOpen] = useState<boolean | null>(null);

  // First value once the saved choice is known.
  useEffect(() => {
    if (open !== null || !prefs.isFetched) return;
    setOpen(options.attention || (prefs.data?.[id] ?? options.defaultOpen));
  }, [open, prefs.isFetched, prefs.data, id, options.attention, options.defaultOpen]);

  // A need that appears later (after a sync, when balances load) opens the card.
  const hadAttention = useRef(options.attention);
  useEffect(() => {
    if (options.attention && !hadAttention.current) setOpen(true);
    hadAttention.current = options.attention;
  }, [options.attention]);

  const firstSignal = useRef(options.openSignal);
  useEffect(() => {
    if (options.openSignal !== firstSignal.current) setOpen(true);
  }, [options.openSignal]);

  const change = (next: boolean) => {
    setOpen(next);
    const saved = { ...(queryClient.getQueryData<UiPrefs>(QK.ui) ?? {}), [id]: next };
    queryClient.setQueryData(QK.ui, saved);
    void store.saveUi(ctx.api.storage, saved).catch(() => undefined);
  };

  return [open ?? (options.attention || options.defaultOpen), change];
}
