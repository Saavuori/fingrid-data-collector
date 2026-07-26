import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import {
  Field,
  Input,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  makeStyles,
} from '@fluentui/react-components';
import { ShieldCheckmark20Regular } from '@fluentui/react-icons';
import Logo from './Logo';
import { errorText } from '../api';

interface LoginFormProps {
  onLoginSuccess: () => void;
}

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: 'calc(100dvh - 160px)',
    padding: '8px 0 24px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    '@media (min-width: 768px)': {
      padding: '32px',
      borderRadius: '24px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      boxShadow: 'var(--shadow-raised)',
    },
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '12px',
  },
  title: {
    fontSize: '26px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
  },
  subtitle: {
    fontSize: '14px',
    lineHeight: 1.5,
    color: 'var(--text-muted)',
    maxWidth: '300px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  hint: {
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--text-faint)',
  },
  link: {
    color: 'var(--accent)',
    fontWeight: 600,
  },
  submit: {
    width: '100%',
    height: '48px',
    justifyContent: 'center',
    borderRadius: '14px',
    fontWeight: 650,
  },
  note: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--text-faint)',
    textAlign: 'center',
  },
});

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const styles = useStyles();
  const [apiKey, setApiKey] = useState('');

  const loginMutation = useMutation({
    mutationFn: async () => {
      await axios.post('api/login', { apiKey });
    },
    onSuccess: onLoginSuccess,
  });

  const errorMessage = errorText(
    loginMutation.error,
    'Fingrid rejected the key — please check it and try again.',
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate();
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.hero}>
          <Logo size={56} radius={16} />
          <span className={styles.title}>Connect to Fingrid</span>
          <span className={styles.subtitle}>
            Add your Fingrid Open Data key to browse the variable catalog and export it.
          </span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <Field label="Fingrid API key" required>
            <Input
              id="login-api-key"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="your-fingrid-api-key"
              size="large"
            />
          </Field>

          <span className={styles.hint}>
            Registration is free and takes about a minute — create an account at{' '}
            <a
              href="https://data.fingrid.fi/"
              target="_blank"
              rel="noreferrer"
              className={styles.link}
            >
              data.fingrid.fi
            </a>{' '}
            to generate a personal key.
          </span>

          {loginMutation.isError && (
            <MessageBar intent="error">
              <MessageBarBody>{errorMessage}</MessageBarBody>
            </MessageBar>
          )}

          <Button
            type="submit"
            appearance="primary"
            size="large"
            disabled={loginMutation.isPending || !apiKey.trim()}
            icon={loginMutation.isPending ? <Spinner size="tiny" /> : undefined}
            className={styles.submit}
          >
            {loginMutation.isPending ? 'Verifying…' : 'Save API key'}
          </Button>
        </form>

        <span className={styles.note}>
          <ShieldCheckmark20Regular fontSize={16} />
          The key is stored on your own FingridFlow server.
        </span>
      </div>
    </div>
  );
};

export default LoginForm;
