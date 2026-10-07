import React from 'react';
import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { ArrowLeft16Regular, ArrowRight16Regular } from '@fluentui/react-icons';

import { usePalette } from '../../theme';
import { useI18n } from '../i18n';
import { href } from '../router';
import { formatValue } from '../format';
import { seriesColor } from '../datasets';

export interface Flow {
  key: string;
  id: number;
  label: string;
  /** MW, positive = from Finland to the neighbour. */
  value: number | undefined;
}

/** Rough compass placement around Finland — a schematic, not a map. */
const PLACES: Record<string, { x: number; y: number; code: string }> = {
  norway: { x: 214, y: 26, code: 'NO' },
  se1: { x: 70, y: 70, code: 'SE1' },
  se3: { x: 62, y: 190, code: 'SE3' },
  estonia: { x: 196, y: 246, code: 'EE' },
  russia: { x: 318, y: 176, code: 'RU' },
};
const FI = { x: 212, y: 140 };

const useStyles = makeStyles({
  svg: {
    display: 'block',
    width: '100%',
    maxWidth: '420px',
    height: 'auto',
    margin: '0 auto',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: '12px',
    minHeight: '38px',
    padding: '0 6px',
    margin: '0 -6px',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'inherit',
    textDecoration: 'none',
    borderTop: '1px solid var(--border)',
    ':hover': { background: 'var(--surface-alt)' },
  },
  name: {
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dir: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    fontWeight: 620,
    color: 'var(--text-muted)',
  },
  value: {
    minWidth: '72px',
    textAlign: 'right',
    fontWeight: 650,
  },
});

const FlowMap: React.FC<{ flows: Flow[] }> = ({ flows }) => {
  const styles = useStyles();
  const palette = usePalette();
  const { t, locale } = useI18n();
  const exportColor = seriesColor(palette, 1);
  const importColor = seriesColor(palette, 0);

  const direction = (v: number | undefined) =>
    v == null || Math.abs(v) < 1 ? 'idle' : v > 0 ? 'export' : 'import';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <svg className={styles.svg} viewBox="0 0 340 272" role="img" aria-label={t.flowsTitle}>
        {flows.map(f => {
          const p = PLACES[f.key];
          if (!p) return null;
          const dir = direction(f.value);
          const color = dir === 'export' ? exportColor : dir === 'import' ? importColor : palette.borderStrong;
          const width = f.value == null ? 1.5 : 2 + 5 * Math.min(1, Math.abs(f.value) / 1500);
          // Drawn from sender to receiver, so the dashes travel with the power.
          const [a, b] = dir === 'import' ? [p, FI] : [FI, p];
          const mx = (p.x + FI.x) / 2;
          const my = (p.y + FI.y) / 2;
          return (
            <g key={f.key}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={palette.border} strokeWidth={width + 4} strokeLinecap="round" />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={width}
                strokeLinecap="round"
                className={dir === 'idle' ? undefined : 'flow-dash'}
              />
              <g transform={`translate(${mx} ${my})`}>
                <rect x={-30} y={-10} width={60} height={20} rx={10} fill={palette.surface} stroke={palette.border} />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={650}
                  fill={palette.text}
                  className="tnum"
                >
                  {f.value == null ? '—' : formatValue(Math.abs(f.value), 0, locale)}
                </text>
              </g>
              <circle cx={p.x} cy={p.y} r={17} fill={palette.surfaceAlt} stroke={palette.borderStrong} />
              <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700} fill={palette.text}>
                {p.code}
              </text>
            </g>
          );
        })}
        <circle cx={FI.x} cy={FI.y} r={24} fill={palette.surface} />
        <circle cx={FI.x} cy={FI.y} r={24} fill={palette.accentSoft} stroke={palette.accent} strokeWidth={1.5} />
        <text x={FI.x} y={FI.y} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={750} fill={palette.text}>
          FI
        </text>
      </svg>

      <div className={styles.list}>
        {flows.map(f => {
          const dir = direction(f.value);
          return (
            <a key={f.key} className={styles.row} href={href(`/d/${f.id}`)}>
              <span className={styles.name}>{f.label}</span>
              <span className={styles.dir}>
                {dir === 'export' && <ArrowRight16Regular style={{ color: exportColor }} />}
                {dir === 'import' && <ArrowLeft16Regular style={{ color: importColor }} />}
                {dir === 'export' ? t.export : dir === 'import' ? t.import : t.idle}
              </span>
              <span className={mergeClasses(styles.value, 'tnum')}>
                {f.value == null ? '—' : `${formatValue(Math.abs(f.value), 0, locale)} MW`}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
};

export default FlowMap;
