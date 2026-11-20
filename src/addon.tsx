import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AddonContext, AddonEnableFunction } from '@wealthfolio/addon-sdk';
import { AddonCtx } from './hooks/use-addon-data';
import { registerAddonTranslations } from './i18n';
import { SyncPage } from './pages/sync-page';

// The host owns a single React root per addon and mounts the route `component`
// itself with no access to the addon context, so capture it at enable time.
// (Do NOT call createRoot yourself — the host manages the lifecycle.)
let addonCtx: AddonContext | undefined;

const AddonRoute = () => {
  const ctx = addonCtx!;
  return (
    <QueryClientProvider client={ctx.api.query.getClient() as QueryClient}>
      <AddonCtx.Provider value={ctx}>
        <SyncPage />
      </AddonCtx.Provider>
    </QueryClientProvider>
  );
};

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;
  // Before the first render, so no untranslated keys flash on screen.
  registerAddonTranslations();

  // The route `id` MUST match `contributes.routes[].id` in manifest.json.
  ctx.router.add({
    id: 'enable-banking-sync',
    path: '/addons/enable-banking-sync',
    component: AddonRoute,
  });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
