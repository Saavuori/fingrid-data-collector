import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FluentProvider, Spinner, makeStyles } from '@fluentui/react-components';

import LoginForm from './components/LoginForm';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import ExploreView from './components/ExploreView';
import CollectView from './components/CollectView';
import SettingsView from './components/SettingsView';
import Logo from './components/Logo';
import { useActiveDatasets } from './hooks/useFingrid';
import { PALETTES, PaletteProvider, applyPaletteToDocument, darkTheme, lightTheme } from './theme';
import type { AuthStatus, TabKey } from './types';

// Configure Axios base URL based on dev vs production build
axios.defaults.baseURL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3001')
  : '';

const useStyles = makeStyles({
  app: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    color: 'var(--text)',
  },
  main: {
    flex: 1,
    width: '100%',
    maxWidth: '1160px',
    margin: '0 auto',
    padding: '16px 16px calc(88px + env(safe-area-inset-bottom))',
    '@media (min-width: 768px)': {
      padding: '28px 24px 48px',
    },
  },
  splash: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    background: 'var(--bg)',
  },
  splashText: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
});

const prefersLight = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;

const App: React.FC = () => {
  const styles = useStyles();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabKey>('explore');
  // Lifted out of ExploreView so the Collect tab can deep-link into a variable.
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [version, setVersion] = useState<string>('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return prefersLight() ? 'light' : 'dark';
  });

  const palette = PALETTES[theme];
  const active = useActiveDatasets();

  const { data: status, isLoading } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const res = await axios.get('api/status');
      return res.data as AuthStatus;
    },
  });

  // Signing out is a local state: the backend keeps the key on disk so the
  // collector keeps running, the UI just asks for it again.
  const [signedOut, setSignedOut] = useState(false);
  const isLoggedIn = status?.logged_in === true && !signedOut;

  useEffect(() => {
    applyPaletteToDocument(palette);
  }, [palette]);

  useEffect(() => {
    axios.get('api/version')
      .then(res => setVersion(res.data.version))
      .catch(() => setVersion(''));
  }, []);

  // Views are swapped in place, so send the reader back to the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, datasetId]);

  const selectTheme = (next: 'dark' | 'light') => {
    localStorage.setItem('theme', next);
    setTheme(next);
  };

  const toggleTheme = () => selectTheme(theme === 'dark' ? 'light' : 'dark');

  const handleSignOut = () => {
    setSignedOut(true);
    setTab('explore');
    setDatasetId(null);
  };

  const handleLoginSuccess = () => {
    setSignedOut(false);
    queryClient.invalidateQueries({ queryKey: ['status'] });
    queryClient.invalidateQueries({ queryKey: ['datasets'] });
  };

  const openDataset = (id: number) => {
    setDatasetId(id);
    setTab('explore');
  };

  return (
    <FluentProvider theme={theme === 'dark' ? darkTheme : lightTheme} style={{ background: 'var(--bg)' }}>
      <PaletteProvider value={palette}>
        {isLoading ? (
          <div className={styles.splash}>
            <Logo size={56} radius={16} />
            <Spinner size="small" />
            <span className={styles.splashText}>Connecting to Fingrid…</span>
          </div>
        ) : (
          <div className={styles.app}>
            <TopBar
              version={version}
              theme={theme}
              onToggleTheme={toggleTheme}
              isLoggedIn={isLoggedIn}
              activeTab={tab}
              onTabChange={setTab}
              onSignOut={handleSignOut}
            />

            <main className={styles.main}>
              {!isLoggedIn ? (
                <LoginForm onLoginSuccess={handleLoginSuccess} />
              ) : tab === 'explore' ? (
                <ExploreView datasetId={datasetId} onOpenDataset={setDatasetId} />
              ) : tab === 'collect' ? (
                <CollectView
                  onOpenDataset={openDataset}
                  onBrowseCatalog={() => {
                    setDatasetId(null);
                    setTab('explore');
                  }}
                />
              ) : (
                <SettingsView
                  version={version}
                  theme={theme}
                  onThemeChange={selectTheme}
                  onSignOut={handleSignOut}
                />
              )}
            </main>

            {isLoggedIn && (
              <BottomNav active={tab} onChange={setTab} collectCount={active.ids.length} />
            )}
          </div>
        )}
      </PaletteProvider>
    </FluentProvider>
  );
};

export default App;
