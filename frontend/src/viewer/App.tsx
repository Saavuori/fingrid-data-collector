import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { FluentProvider, makeStyles } from '@fluentui/react-components';

import { PALETTES, PaletteProvider, applyPaletteToDocument, darkTheme, lightTheme } from '../theme';
import { I18nProvider, initialLang, makeI18n, type Lang } from './i18n';
import { useRoute } from './router';
import { Footer, TabBar, TopBar } from './components/Shell';
import NowView from './components/NowView';
import CatalogView from './components/CatalogView';
import SeriesView from './components/SeriesView';

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
    maxWidth: '1240px',
    margin: '0 auto',
    padding: '16px 16px 24px',
    '@media (min-width: 768px)': {
      padding: '28px 24px 40px',
    },
  },
  // Clears the fixed tab bar on phones.
  tabSpacer: {
    height: 'calc(72px + env(safe-area-inset-bottom))',
    '@media (min-width: 768px)': {
      display: 'none',
    },
  },
});

const store = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or blocked storage: the choice lasts for this visit.
    }
  },
};

const App: React.FC = () => {
  const styles = useStyles();
  const { route } = useRoute();

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = store.get('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [lang, setLang] = useState<Lang>(initialLang);
  const [version, setVersion] = useState('');

  const palette = PALETTES[theme];
  const i18n = useMemo(() => makeI18n(lang), [lang]);

  useEffect(() => applyPaletteToDocument(palette), [palette]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${i18n.t.appName} — ${i18n.t.tagline}`;
  }, [lang, i18n]);

  useEffect(() => {
    axios
      .get('api/version')
      .then(res => setVersion(res.data.version ?? ''))
      .catch(() => setVersion(''));
  }, []);

  // Views swap in place, so a new page starts at the top.
  const routeKey = route.name === 'dataset' ? `d${route.id}` : route.name;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [routeKey]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    store.set('theme', next);
    setTheme(next);
  };

  const toggleLang = () => {
    const next = lang === 'fi' ? 'en' : 'fi';
    store.set('lang', next);
    setLang(next);
  };

  const section = route.name === 'now' ? 'now' : 'explore';

  return (
    <FluentProvider theme={theme === 'dark' ? darkTheme : lightTheme} style={{ background: 'var(--bg)' }}>
      <PaletteProvider value={palette}>
        <I18nProvider value={i18n}>
          <div className={styles.app}>
            <TopBar section={section} theme={theme} onToggleTheme={toggleTheme} onToggleLang={toggleLang} />
            <main className={styles.main}>
              {route.name === 'now' ? (
                <NowView />
              ) : route.name === 'explore' ? (
                <CatalogView />
              ) : (
                <SeriesView key={route.id} id={route.id} />
              )}
            </main>
            <Footer version={version} />
            <div className={styles.tabSpacer} />
            <TabBar section={section} />
          </div>
        </I18nProvider>
      </PaletteProvider>
    </FluentProvider>
  );
};

export default App;
