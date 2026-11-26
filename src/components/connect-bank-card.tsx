import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Button,
  Input,
} from '@wealthfolio/ui';
import { Landmark, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { completeBankAuthorization, maxConsentDays, startBankAuthorization } from '../lib/connect';
import type { EbAspsp } from '../lib/eb-types';
import { addDays, store, toIsoDate } from '../lib/state';
import {
  QK,
  useAddonCtx,
  useApplication,
  useClient,
  useSaveConnections,
  type AddonState,
} from '../hooks/use-addon-data';
import { useText } from '../i18n';
import { CollapsibleCard } from './collapsible-card';
import { CopyField, Field, NativeSelect } from './ui-bits';

const PSD2_COUNTRIES = [
  'ES', 'PT', 'FR', 'IT', 'DE', 'NL', 'BE', 'LU', 'IE', 'AT', 'FI', 'SE', 'DK', 'NO', 'IS',
  'EE', 'LV', 'LT', 'PL', 'CZ', 'SK', 'SI', 'HR', 'HU', 'RO', 'BG', 'GR', 'CY', 'MT', 'LI', 'GB',
];

function regionNamesFor(language: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([language], { type: 'region' });
  } catch {
    return null;
  }
}

export const DEFAULT_HISTORY_DAYS = 90;

export function ConnectBankCard({
  state,
  reconnect,
  onReconnectHandled,
}: {
  state: AddonState;
  /** Bank to preselect when renewing an expired consent. */
  reconnect?: { name: string; country: string } | null;
  onReconnectHandled?: () => void;
}) {
  const ctx = useAddonCtx();
  const { t, rich, language, errorText } = useText();
  const regionNames = useMemo(() => regionNamesFor(language), [language]);
  const queryClient = useQueryClient();
  const client = useClient(state);
  const application = useApplication(state);
  const saveConnections = useSaveConnections();

  const [country, setCountry] = useState(state.config.country || 'ES');
  const [filter, setFilter] = useState('');
  const [bankName, setBankName] = useState('');
  const [consentDays, setConsentDays] = useState(90);
  const [redirectUrl, setRedirectUrl] = useState(state.config.redirectUrl ?? '');
  const [redirectInput, setRedirectInput] = useState('');
  const [busy, setBusy] = useState<'start' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirectUrls = application.data?.redirect_urls ?? [];
  useEffect(() => {
    if (!redirectUrl && redirectUrls.length > 0) setRedirectUrl(redirectUrls[0]);
  }, [redirectUrl, redirectUrls]);

  useEffect(() => {
    if (reconnect) {
      setCountry(reconnect.country);
      setBankName(reconnect.name);
      setFilter('');
    }
  }, [reconnect]);

  const aspsps = useQuery<EbAspsp[]>({
    queryKey: QK.aspsps(state.config.applicationId, country),
    queryFn: async () => {
      const list = await client!.getAspsps(country);
      return list
        .filter((a) => !a.psu_types || a.psu_types.includes('personal'))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: Boolean(client),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const visibleBanks = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = aspsps.data ?? [];
    return term ? list.filter((a) => a.name.toLowerCase().includes(term)) : list;
  }, [aspsps.data, filter]);

  const selectedBank = aspsps.data?.find((a) => a.name === bankName);
  const maxDays = maxConsentDays(selectedBank);
  useEffect(() => {
    setConsentDays(Math.min(maxDays, 180));
  }, [maxDays]);

  const pending = state.pending;

  const start = async () => {
    if (!client || !selectedBank) return;
    setError(null);
    setBusy('start');
    try {
      const authorization = await startBankAuthorization(client, {
        aspsp: { name: selectedBank.name, country: selectedBank.country },
        consentDays: Math.max(1, Math.min(consentDays, maxDays)),
        redirectUrl,
      });
      await store.savePending(ctx.api.storage, authorization);
      await store.saveConfig(ctx.api.storage, { ...state.config, country, redirectUrl });
      setRedirectInput('');
      await queryClient.invalidateQueries({ queryKey: QK.state });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const complete = async () => {
    if (!client || !pending) return;
    setError(null);
    setBusy('complete');
    try {
      const defaultSyncFrom = addDays(toIsoDate(new Date()), -DEFAULT_HISTORY_DAYS);
      const result = await completeBankAuthorization(
        client,
        pending,
        redirectInput,
        state.connections,
        defaultSyncFrom,
      );
      await saveConnections(result.connections);
      await store.clearPending(ctx.api.storage);
      if (result.replaced && result.replaced.sessionId !== result.connection.sessionId) {
        // Best effort: revoke the superseded session.
        client.deleteSession(result.replaced.sessionId).catch(() => undefined);
      }
      await queryClient.invalidateQueries({ queryKey: QK.state });
      setRedirectInput('');
      onReconnectHandled?.();
      ctx.api.toast.success(
        t('connect.connectedToast', { bank: result.connection.aspsp.name, n: result.connection.accounts.length }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const cancelPending = async () => {
    await store.clearPending(ctx.api.storage);
    setRedirectInput('');
    setError(null);
    await queryClient.invalidateQueries({ queryKey: QK.state });
  };

  return (
    <CollapsibleCard
      id="connect"
      icon={<Landmark className="size-4" />}
      title={reconnect ? t('connect.titleRenew', { bank: reconnect.name }) : t('connect.titleNew')}
      description={t('connect.description')}
      defaultOpen={state.connections.length === 0}
      attention={Boolean(pending || reconnect)}
      contentClassName="space-y-4"
    >
        {!pending && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('connect.country')}>
                <NativeSelect value={country} onChange={(e) => { setCountry(e.target.value); setBankName(''); }}>
                  {PSD2_COUNTRIES.map((code) => (
                    <option key={code} value={code}>
                      {regionNames?.of(code) ?? code}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('connect.search')}>
                <Input placeholder={t('connect.searchPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
              </Field>
            </div>

            <Field label={t('connect.bank')}>
              {aspsps.isLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <LoaderCircle className="size-4 animate-spin" /> {t('connect.loadingBanks')}
                </div>
              ) : aspsps.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{errorText(aspsps.error)}</AlertDescription>
                </Alert>
              ) : (
                <NativeSelect value={bankName} onChange={(e) => setBankName(e.target.value)} size={Math.min(8, Math.max(3, visibleBanks.length))} className="h-auto py-1">
                  {visibleBanks.map((bank) => (
                    <option key={`${bank.country}-${bank.name}`} value={bank.name}>
                      {bank.name}
                      {bank.beta ? ' (beta)' : ''}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('connect.consentDays')} hint={selectedBank ? t('connect.consentMax', { n: maxDays }) : undefined}>
                <Input
                  type="number"
                  min={1}
                  max={maxDays}
                  value={consentDays}
                  onChange={(e) => setConsentDays(Number(e.target.value) || 1)}
                />
              </Field>
              <Field label={t('connect.redirect')} hint={t('connect.redirectHint')}>
                {redirectUrls.length > 0 ? (
                  <NativeSelect value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)}>
                    {redirectUrls.map((url) => (
                      <option key={url} value={url}>
                        {url}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input value={redirectUrl} placeholder="https://localhost/callback" onChange={(e) => setRedirectUrl(e.target.value)} />
                )}
              </Field>
            </div>

            <Button onClick={start} disabled={!selectedBank || !redirectUrl || busy !== null}>
              {busy === 'start' && <LoaderCircle className="size-4 animate-spin" />}
              {t('connect.generate')}
            </Button>
          </>
        )}

        {pending && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-3 ps-5 text-sm">
              <li>
                {rich('connect.step1', { bank: <b>{pending.aspsp.name}</b> })}
                <div className="mt-2">
                  <CopyField value={pending.url} />
                </div>
              </li>
              <li>
                {rich('connect.step2', {
                  url: <span className="font-mono">{pending.redirectUrl}</span>,
                  code: <span className="font-mono">?code=…</span>,
                })}
              </li>
              <li>
                {t('connect.step3')}
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder={`${pending.redirectUrl}?state=…&code=…`}
                    value={redirectInput}
                    onChange={(e) => setRedirectInput(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button onClick={complete} disabled={!redirectInput.trim() || busy !== null}>
                    {busy === 'complete' && <LoaderCircle className="size-4 animate-spin" />}
                    {t('connect.complete')}
                  </Button>
                </div>
              </li>
            </ol>
            <Button variant="ghost" size="sm" onClick={cancelPending} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
    </CollapsibleCard>
  );
}
