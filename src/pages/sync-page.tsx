import { Alert, AlertDescription, Page, PageContent, PageHeader, Skeleton } from '@wealthfolio/ui';
import { useState } from 'react';
import { ConnectBankCard } from '../components/connect-bank-card';
import { ConnectionsCard } from '../components/connections-card';
import { SettingsCard } from '../components/settings-card';
import { SyncCard } from '../components/sync-card';
import { errorText } from '../components/ui-bits';
import { isConfigured, useAddonState } from '../hooks/use-addon-data';

export function SyncPage() {
  const { data: state, isLoading, error } = useAddonState();
  const [reconnect, setReconnect] = useState<{ name: string; country: string } | null>(null);

  return (
    <Page>
      <PageHeader
        heading="Sincronizar bancos"
        text="Importa con un botón los movimientos de tus cuentas bancarias mediante Enable Banking (Open Banking PSD2)."
      />
      <PageContent>
        <div className="mx-auto max-w-4xl space-y-6 pb-10">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{errorText(error)}</AlertDescription>
            </Alert>
          )}
          {state && (
            <>
              {isConfigured(state) && <SyncCard state={state} />}
              {isConfigured(state) && (
                <ConnectionsCard
                  state={state}
                  onReconnect={(aspsp) => {
                    setReconnect(aspsp);
                    requestAnimationFrame(() =>
                      document.getElementById('connect-bank')?.scrollIntoView({ behavior: 'smooth' }),
                    );
                  }}
                />
              )}
              {isConfigured(state) && (
                <div id="connect-bank">
                <ConnectBankCard
                  key={reconnect ? `${reconnect.country}-${reconnect.name}` : 'new'}
                  state={state}
                  reconnect={reconnect}
                  onReconnectHandled={() => setReconnect(null)}
                />
                </div>
              )}
              <SettingsCard state={state} />
            </>
          )}
        </div>
      </PageContent>
    </Page>
  );
}
