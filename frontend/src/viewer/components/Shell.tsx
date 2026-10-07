import React from 'react';
import { Button, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  Flash24Regular,
  Flash24Filled,
  GlobeSearch24Regular,
  GlobeSearch24Filled,
  WeatherSunny24Regular,
  WeatherMoon24Regular,
} from '@fluentui/react-icons';

import Logo from '../../components/Logo';
import { useI18n } from '../i18n';
import { href } from '../router';

export type Section = 'now' | 'explore';

const useStyles = makeStyles({
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 800,
    background: 'var(--glass)',
    backdropFilter: 'saturate(180%) blur(16px)',
    WebkitBackdropFilter: 'saturate(180%) blur(16px)',
    borderBottom: '1px solid var(--border)',
    paddingTop: 'env(safe-area-inset-top)',
  },
  inner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    height: '56px',
    padding: '0 8px 0 16px',
    maxWidth: '1240px',
    margin: '0 auto',
    '@media (min-width: 768px)': {
      height: '64px',
      padding: '0 24px',
    },
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
    color: 'inherit',
    textDecoration: 'none',
  },
  wordmark: {
    fontSize: '17px',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  tagline: {
    display: 'none',
    fontSize: '11px',
    color: 'var(--text-faint)',
    '@media (min-width: 480px)': {
      display: 'block',
    },
  },
  spacer: { flex: 1 },
  nav: {
    display: 'none',
    '@media (min-width: 768px)': {
      display: 'flex',
      gap: '4px',
    },
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '38px',
    padding: '0 14px',
    borderRadius: '999px',
    color: 'var(--text-muted)',
    fontSize: '14px',
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'background 0.18s ease, color 0.18s ease',
    ':hover': {
      background: 'var(--surface-alt)',
      color: 'var(--text)',
    },
  },
  navLinkActive: {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    ':hover': {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
    },
  },
  lang: {
    minWidth: 0,
    fontWeight: 650,
  },

  tabs: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 800,
    display: 'flex',
    background: 'var(--glass)',
    backdropFilter: 'saturate(180%) blur(16px)',
    WebkitBackdropFilter: 'saturate(180%) blur(16px)',
    borderTop: '1px solid var(--border)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    '@media (min-width: 768px)': {
      display: 'none',
    },
  },
  tab: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '3px',
    minHeight: '56px',
    padding: '8px 0 6px',
    color: 'var(--text-faint)',
    textDecoration: 'none',
  },
  tabActive: {
    color: 'var(--accent)',
  },
  tabIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '52px',
    height: '26px',
    borderRadius: '999px',
  },
  tabIconActive: {
    background: 'var(--accent-soft)',
  },
  tabLabel: {
    fontSize: '11px',
    fontWeight: 600,
  },

  footer: {
    maxWidth: '1240px',
    margin: '0 auto',
    padding: '8px 20px 0',
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--text-faint)',
    '@media (min-width: 768px)': {
      padding: '0 24px 32px',
    },
  },
  footerLink: {
    color: 'inherit',
  },
});

const SECTIONS = [
  { key: 'now' as const, path: '/', icon: Flash24Regular, iconActive: Flash24Filled },
  { key: 'explore' as const, path: '/explore', icon: GlobeSearch24Regular, iconActive: GlobeSearch24Filled },
];

export const TopBar: React.FC<{
  section: Section;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onToggleLang: () => void;
}> = ({ section, theme, onToggleTheme, onToggleLang }) => {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <a className={styles.brand} href={href('/')}>
          <Logo size={30} />
          <div>
            <span className={styles.wordmark}>{t.appName}</span>
            <span className={styles.tagline}>{t.tagline}</span>
          </div>
        </a>
        <div className={styles.spacer} />
        <nav className={styles.nav} aria-label="Sections">
          {SECTIONS.map(s => {
            const active = s.key === section;
            const Icon = active ? s.iconActive : s.icon;
            return (
              <a
                key={s.key}
                href={href(s.path)}
                aria-current={active ? 'page' : undefined}
                className={mergeClasses(styles.navLink, active && styles.navLinkActive)}
              >
                <Icon fontSize={20} />
                {s.key === 'now' ? t.navNow : t.navExplore}
              </a>
            );
          })}
        </nav>
        <Button appearance="subtle" className={styles.lang} onClick={onToggleLang} aria-label={t.switchLanguage}>
          {t.switchLanguage === 'Suomeksi' ? 'FI' : 'EN'}
        </Button>
        <Button
          appearance="subtle"
          shape="circular"
          icon={theme === 'dark' ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />}
          onClick={onToggleTheme}
          aria-label={t.switchTheme}
        />
      </div>
    </header>
  );
};

export const TabBar: React.FC<{ section: Section }> = ({ section }) => {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <nav className={styles.tabs} aria-label="Sections">
      {SECTIONS.map(s => {
        const active = s.key === section;
        const Icon = active ? s.iconActive : s.icon;
        return (
          <a
            key={s.key}
            href={href(s.path)}
            aria-current={active ? 'page' : undefined}
            className={mergeClasses(styles.tab, active && styles.tabActive)}
          >
            <span className={mergeClasses(styles.tabIcon, active && styles.tabIconActive)}>
              <Icon fontSize={22} />
            </span>
            <span className={styles.tabLabel}>{s.key === 'now' ? t.navNow : t.navExplore}</span>
          </a>
        );
      })}
    </nav>
  );
};

export const Footer: React.FC<{ version: string }> = ({ version }) => {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <footer className={styles.footer}>
      {t.footer}{' '}
      <a className={styles.footerLink} href="https://data.fingrid.fi" target="_blank" rel="noreferrer">
        data.fingrid.fi
      </a>
      {version ? ` · ${version}` : ''}
    </footer>
  );
};
