import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Textarea,
} from '@wealthfolio/ui';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  EnableBankingClient,
  JWT_SECRET,
  PRIVATE_KEY_SECRET,
  resetTokenCache,
} from '../lib/enable-banking-client';
import { pemToPkcs8Der } from '../lib/jwt';
import { store } from '../lib/state';
import {
  isConfigured,
  QK,
  useAddonCtx,
  useApplication,
  type AddonState,
} from '../hooks/use-addon-data';
import { useText } from '../i18n';
import { CollapsibleCard } from './collapsible-card';
import { Field } from './ui-bits';

export function SettingsCard({ state }: { state: AddonState }) {
  const ctx = useAddonCtx();
  const { t, rich, errorText } = useText();
  const queryClient = useQueryClient();
  const application = useApplication(state);
  const configured = isConfigured(state);

  const [editing, setEditing] = useState(!configured);
  const [applicationId, setApplicationId] = useState(state.config.applicationId);
  const [pem, setPem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) setEditing(true);
  }, [configured]);

  const onFile = async (file?: File) => {
    if (!file) return;
    setPem(await file.text());
    // Enable Banking names the key file after the application id.
    const id = file.name.replace(/\.pem$/i, '');
    if (!applicationId && /^[0-9a-f-]{36}$/i.test(id)) setApplicationId(id);
  };

  const save = async () => {
    setError(null);
    const id = applicationId.trim();
    if (!id) return setError(t('settings.needAppId'));
    if (!pem.trim() && !state.hasPrivateKey) return setError(t('settings.needKey'));
    setBusy(true);
    const previousKey = await ctx.api.secrets.get(PRIVATE_KEY_SECRET).catch(() => null);
    try {
      if (pem.trim()) {
        pemToPkcs8Der(pem); // validates the format before storing it
        await ctx.api.secrets.set(PRIVATE_KEY_SECRET, pem.trim());
      }
      resetTokenCache();
      // Check the credentials before keeping them.
      const app = await new EnableBankingClient(ctx.api, id).getApplication();
      await store.saveConfig(ctx.api.storage, { ...state.config, applicationId: id });
      queryClient.setQueryData(QK.application(id), app);
      await queryClient.invalidateQueries({ queryKey: QK.state });
      setPem('');
      setEditing(false);
      ctx.api.toast.success(t('settings.connectedToast', { name: app.name ?? id }));
    } catch (e) {
      // Restore the previous key so a typo does not break a working setup.
      if (pem.trim()) {
        if (previousKey) await ctx.api.secrets.set(PRIVATE_KEY_SECRET, previousKey);
        else await ctx.api.secrets.delete(PRIVATE_KEY_SECRET).catch(() => undefined);
      }
      resetTokenCache();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    await ctx.api.secrets.delete(PRIVATE_KEY_SECRET).catch(() => undefined);
    await ctx.api.secrets.delete(JWT_SECRET).catch(() => undefined);
    resetTokenCache();
    await queryClient.invalidateQueries({ queryKey: QK.state });
    setEditing(true);
  };

  const app = application.data;
  const redirectUrls = app?.redirect_urls ?? [];

  return (
    <CollapsibleCard
      id="settings"
      icon={<KeyRound className="size-4" />}
      title={t('settings.title')}
      badge={
        configured && !application.isError ? (
          <Badge variant="success-subtle">{t('settings.configured')}</Badge>
        ) : undefined
      }
      summary={app?.name}
      description={rich('settings.description', { environment: <b>Production</b> })}
      defaultOpen={!configured}
      attention={!configured || application.isError}
      contentClassName="space-y-4"
    >
        {configured && !editing && (
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t('settings.appIdLabel')} </span>
              <span className="font-mono">{state.config.applicationId}</span>
            </div>
            {application.isLoading && (
              <div className="text-muted-foreground flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> {t('settings.checking')}
              </div>
            )}
            {app && (
              <div className="text-muted-foreground">
                {app.name} · {app.environment ?? t('settings.unknownEnvironment')}
                {app.active === false && ` · ${t('settings.inactive')}`}
              </div>
            )}
            {application.isError && (
              <Alert variant="destructive">
                <AlertTitle>{t('settings.validateFailed')}</AlertTitle>
                <AlertDescription>{errorText(application.error)}</AlertDescription>
              </Alert>
            )}
            {app && redirectUrls.length === 0 && (
              <Alert variant="warning">
                <AlertTitle>{t('settings.noRedirectTitle')}</AlertTitle>
                <AlertDescription>{t('settings.noRedirect')}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('settings.change')}
              </Button>
              <Button variant="ghost" size="sm" onClick={forget}>
                {t('settings.deleteKey')}
              </Button>
            </div>
          </div>
        )}

        {editing && (
          <div className="space-y-4">
            <Field label={t('settings.appIdField')} htmlFor="eb-app-id" hint={t('settings.appIdHint')}>
              <Input
                id="eb-app-id"
                placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field
              label={t('settings.keyField')}
              hint={state.hasPrivateKey ? t('settings.keyHintSaved') : t('settings.keyHintNew')}
            >
              <input
                type="file"
                accept=".pem,.key,.txt"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="text-sm"
              />
              <Textarea
                rows={4}
                placeholder="-----BEGIN PRIVATE KEY-----"
                value={pem}
                onChange={(e) => setPem(e.target.value)}
                className="mt-2 font-mono text-xs"
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                {t('settings.save')}
              </Button>
              {configured && (
                <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
    </CollapsibleCard>
  );
}
