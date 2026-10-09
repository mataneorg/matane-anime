import {
  type AppSettings,
  DOH_MODES,
  DOH_PROVIDERS,
  type DohMode,
  type DohProvider,
  type NetworkTestResult,
  PROXY_MODES,
  type ProxyMode,
  type SettingsPatch,
} from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, TriangleAlert, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { RadioGroup, RadioOption } from '@renderer/components/ui/radio-group';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { ipc, settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';

const proxyPasswordQuery = {
  queryKey: ['network', 'proxyPassword'],
  queryFn: () => ipc.invoke('network.proxyPasswordInfo'),
  staleTime: Infinity,
} as const;

/** The same rules as main's `network/config.ts`; main checks again, this only keeps a bad value from being saved. */
const isHttpsUrl = (text: string): boolean => {
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
};
const isPrintableAscii = (text: string): boolean => /^[\x20-\x7e]+$/.test(text);

/** Settings → Network (mockup 10b): DNS over HTTPS, proxy, User-Agent, and a test of what is on screen. */
export function NetworkSettings() {
  const { data: settings } = useQuery(settingsQuery);
  if (!settings) return null;
  return <NetworkForm settings={settings} />;
}

function NetworkForm({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdateSettings();
  const { data: passwordInfo } = useQuery(proxyPasswordQuery);

  // What is typed, until it is saved with Enter or by leaving the field (and only when it is valid).
  const [dohUrl, setDohUrl] = useState(settings.dohCustomUrl);
  const [host, setHost] = useState(settings.proxyHost);
  const [port, setPort] = useState(settings.proxyPort === null ? '' : String(settings.proxyPort));
  const [user, setUser] = useState(settings.proxyUser);
  const [password, setPassword] = useState('');
  // Null until the box is touched: then it follows what is saved (the stored password arrives a moment later).
  const [loginChoice, setLoginChoice] = useState<boolean | null>(settings.proxyUser !== '' ? true : null);
  const needsLogin = loginChoice ?? passwordInfo?.stored === true;
  const [customAgent, setCustomAgent] = useState(settings.userAgent !== null);
  const [agent, setAgent] = useState(settings.userAgent ?? '');
  const [result, setResult] = useState<NetworkTestResult | null>(null);

  const dohUrlInvalid = dohUrl.trim() !== '' && !isHttpsUrl(dohUrl.trim());
  const portNumber = port.trim() === '' ? null : Number(port);
  const portInvalid = portNumber !== null && !(Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535);
  const agentInvalid = agent.trim() !== '' && !isPrintableAscii(agent.trim());
  const hasProxy = settings.proxyMode === 'http' || settings.proxyMode === 'socks5';

  const save = (patch: SettingsPatch): void => {
    setResult(null);
    update.mutate(patch);
  };
  const commitDohUrl = (): void => {
    const value = dohUrl.trim();
    if (!dohUrlInvalid && value !== settings.dohCustomUrl) save({ dohCustomUrl: value });
  };
  const commitHost = (): void => {
    if (host.trim() !== settings.proxyHost) save({ proxyHost: host.trim() });
  };
  const commitPort = (): void => {
    if (!portInvalid && portNumber !== settings.proxyPort) save({ proxyPort: portNumber });
  };
  const commitUser = (): void => {
    if (user !== settings.proxyUser) save({ proxyUser: user });
  };
  const commitAgent = (): void => {
    const value = agent.trim() || null;
    if (!agentInvalid && value !== settings.userAgent) save({ userAgent: value });
  };

  const storePassword = useMutation({
    mutationFn: (value: string | null) => ipc.invoke('network.setProxyPassword', { password: value }),
    onSuccess: (info) => {
      queryClient.setQueryData(proxyPasswordQuery.queryKey, info);
      setPassword('');
      setResult(null);
    },
    onError: () => notify.error(t('settings.network.passwordFailed')),
  });
  const commitPassword = (): void => {
    if (password !== '') storePassword.mutate(password);
  };
  const toggleLogin = (checked: boolean): void => {
    setLoginChoice(checked);
    if (checked) return;
    setUser('');
    setPassword('');
    if (settings.proxyUser !== '') save({ proxyUser: '' });
    if (passwordInfo?.stored) storePassword.mutate(null);
  };
  const setProxyMode = (mode: ProxyMode): void => {
    if (mode === 'system' || mode === 'none') setLoginChoice(false);
    save({ proxyMode: mode });
  };
  const toggleAgent = (checked: boolean): void => {
    setCustomAgent(checked);
    if (!checked) {
      setAgent('');
      if (settings.userAgent !== null) save({ userAgent: null });
    }
  };
  const resetAgent = (): void => {
    setAgent('');
    if (settings.userAgent !== null) save({ userAgent: null });
  };

  const test = useMutation({
    mutationFn: () =>
      ipc.invoke('network.testConnection', {
        // The form as it is on screen, saved or not; main fills in whatever is left out from the saved settings.
        settings: {
          dohMode: settings.dohMode,
          dohProvider: settings.dohProvider,
          dohCustomUrl: dohUrl.trim(),
          proxyMode: settings.proxyMode,
          proxyHost: host.trim(),
          proxyPort: portInvalid ? null : portNumber,
          proxyUser: needsLogin ? user : '',
          userAgent: customAgent && !agentInvalid ? agent.trim() || null : null,
        },
        ...(needsLogin && password !== '' ? { proxyPassword: password } : {}),
      }),
    onSuccess: setResult,
    onError: () => setResult({ ok: false, ms: null, error: t('settings.network.testFailed') }),
  });

  const onEnter = (commit: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter') commit();
  };

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <p className="text-muted-foreground">{t('settings.network.intro')}</p>

      <section className="flex flex-col gap-3 rounded-xl border bg-card/40 p-5" aria-labelledby="doh-title">
        <h2 id="doh-title" className="text-sm font-semibold">
          {t('settings.network.doh')}
        </h2>
        <RadioGroup
          value={settings.dohMode}
          onValueChange={(value) => save({ dohMode: value as DohMode })}
          aria-label={t('settings.network.doh')}
        >
          {DOH_MODES.map((mode) => (
            <RadioOption key={mode} value={mode}>
              {t(`settings.network.dohModes.${mode}`)}
            </RadioOption>
          ))}
        </RadioGroup>
        <div className="flex flex-wrap gap-4">
          <div className="flex w-62 flex-col gap-1">
            <label htmlFor="doh-provider" className="text-xs leading-4 font-medium">
              {t('settings.network.provider')}
            </label>
            <Select
              id="doh-provider"
              value={settings.dohProvider}
              disabled={settings.dohMode === 'off'}
              onChange={(event) => save({ dohProvider: event.target.value as DohProvider })}
            >
              {DOH_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {t(`settings.network.providers.${provider}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex w-62 flex-col gap-1">
            <label htmlFor="doh-url" className="text-xs leading-4 font-medium">
              {t('settings.network.customUrl')}
            </label>
            <Input
              id="doh-url"
              className="font-mono"
              placeholder="https://dns.example.net/dns-query"
              value={dohUrl}
              disabled={settings.dohMode === 'off' || settings.dohProvider !== 'custom'}
              aria-invalid={dohUrlInvalid}
              onChange={(event) => setDohUrl(event.target.value)}
              onBlur={commitDohUrl}
              onKeyDown={onEnter(commitDohUrl)}
            />
            {dohUrlInvalid ? (
              <p role="alert" className="text-xs leading-4 text-danger-text">
                {t('settings.network.httpsOnly')}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card/40 p-5" aria-labelledby="proxy-title">
        <h2 id="proxy-title" className="text-sm font-semibold">
          {t('settings.network.proxy')}
        </h2>
        <div className="flex flex-wrap gap-4">
          <div className="flex w-45 flex-col gap-1">
            <label htmlFor="proxy-type" className="text-xs leading-4 font-medium">
              {t('settings.network.proxyType')}
            </label>
            <Select
              id="proxy-type"
              value={settings.proxyMode}
              onChange={(event) => setProxyMode(event.target.value as ProxyMode)}
            >
              {PROXY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`settings.network.proxyModes.${mode}`)}
                </option>
              ))}
            </Select>
          </div>
          {hasProxy ? (
            <>
              <div className="flex w-60 flex-col gap-1">
                <label htmlFor="proxy-host" className="text-xs leading-4 font-medium">
                  {t('settings.network.host')}
                </label>
                <Input
                  id="proxy-host"
                  className="font-mono"
                  placeholder="proxy.example.net"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  onBlur={commitHost}
                  onKeyDown={onEnter(commitHost)}
                />
              </div>
              <div className="flex w-30 flex-col gap-1">
                <label htmlFor="proxy-port" className="text-xs leading-4 font-medium">
                  {t('settings.network.port')}
                </label>
                <Input
                  id="proxy-port"
                  className="font-mono"
                  inputMode="numeric"
                  placeholder="8080"
                  value={port}
                  aria-invalid={portInvalid}
                  onChange={(event) => setPort(event.target.value)}
                  onBlur={commitPort}
                  onKeyDown={onEnter(commitPort)}
                />
              </div>
            </>
          ) : null}
        </div>
        {portInvalid && hasProxy ? (
          <p role="alert" className="text-xs leading-4 text-danger-text">
            {t('settings.network.portInvalid')}
          </p>
        ) : null}
        {settings.proxyMode === 'system' ? (
          <p className="text-xs leading-4 text-muted-foreground">{t('settings.network.systemHint')}</p>
        ) : null}
        {hasProxy ? (
          <>
            <label className="flex w-fit cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={needsLogin}
                onChange={(event) => toggleLogin(event.target.checked)}
              />
              {t('settings.network.needsLogin')}
            </label>
            {needsLogin ? (
              <div className="flex flex-wrap gap-4">
                <div className="flex w-60 flex-col gap-1">
                  <label htmlFor="proxy-user" className="text-xs leading-4 font-medium">
                    {t('settings.network.user')}
                  </label>
                  <Input
                    id="proxy-user"
                    autoComplete="off"
                    value={user}
                    onChange={(event) => setUser(event.target.value)}
                    onBlur={commitUser}
                    onKeyDown={onEnter(commitUser)}
                  />
                </div>
                <div className="flex w-60 flex-col gap-1">
                  <label htmlFor="proxy-password" className="text-xs leading-4 font-medium">
                    {t('settings.network.password')}
                  </label>
                  <Input
                    id="proxy-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={passwordInfo?.stored ? t('settings.network.passwordSaved') : ''}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={commitPassword}
                    onKeyDown={onEnter(commitPassword)}
                  />
                </div>
                {passwordInfo?.stored ? (
                  <Button
                    variant="secondary"
                    className="self-end"
                    onClick={() => storePassword.mutate(null)}
                    disabled={storePassword.isPending}
                  >
                    {t('settings.network.removePassword')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {settings.proxyMode === 'socks5' && needsLogin ? (
              <p className="text-xs leading-4 text-muted-foreground">{t('settings.network.socksLogin')}</p>
            ) : null}
          </>
        ) : null}
        <p className="max-w-[640px] text-xs leading-4 text-muted-foreground">{t('settings.network.passwordStorage')}</p>
        {needsLogin && passwordInfo && !passwordInfo.encrypted ? (
          <p role="alert" className="flex max-w-[640px] items-start gap-2 text-xs leading-4 text-warning-text">
            <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {t('settings.network.plainWarning')}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card/40 p-5" aria-labelledby="agent-title">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <h2 id="agent-title" className="text-sm font-semibold">
              {t('settings.network.userAgent')}
            </h2>
            <div className="text-xs leading-4 text-muted-foreground">{t('settings.network.userAgentHint')}</div>
          </div>
          <Switch checked={customAgent} onCheckedChange={toggleAgent} aria-labelledby="agent-title" />
        </div>
        {customAgent ? (
          <div className="flex gap-2">
            <Input
              aria-label={t('settings.network.userAgent')}
              className="flex-1 font-mono"
              placeholder="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"
              value={agent}
              aria-invalid={agentInvalid}
              onChange={(event) => setAgent(event.target.value)}
              onBlur={commitAgent}
              onKeyDown={onEnter(commitAgent)}
            />
            <Button variant="secondary" onClick={resetAgent}>
              {t('settings.network.resetAgent')}
            </Button>
          </div>
        ) : null}
        {agentInvalid ? (
          <p role="alert" className="text-xs leading-4 text-danger-text">
            {t('settings.network.agentInvalid')}
          </p>
        ) : null}
      </section>

      <section
        className="flex flex-wrap items-center gap-4 rounded-xl border bg-card/40 p-5"
        aria-label={t('settings.network.test')}
      >
        <Button size="lg" onClick={() => test.mutate()} disabled={test.isPending}>
          <Globe className="size-4" strokeWidth={1.75} aria-hidden />
          {test.isPending ? t('settings.network.testing') : t('settings.network.test')}
        </Button>
        {result ? (
          result.ok ? (
            <p role="status" className="flex items-center gap-2">
              <Check className="size-4 text-ctp-green" strokeWidth={2} aria-hidden />
              <span className="font-medium">{t('settings.network.connected')}</span>
              <span className="rounded-md border bg-muted px-1.5 font-mono text-xs leading-5">
                {t('settings.network.ms', { ms: result.ms ?? 0 })}
              </span>
              <span className="text-xs leading-4 text-muted-foreground">{t('settings.network.withSettings')}</span>
            </p>
          ) : (
            <p role="alert" className="flex items-center gap-2 text-danger-text">
              <X className="size-4" strokeWidth={2} aria-hidden />
              <span>{result.error ?? t('settings.network.testFailed')}</span>
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
