import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Configure Axios base URL based on dev vs production build
axios.defaults.baseURL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3001') 
  : '';
import {
  Button,
  Input,
  Text,
  Switch,
  Spinner,
  MessageBar,
  MessageBarBody,
  tokens,
  makeStyles,
  Badge,
  shorthands,
} from '@fluentui/react-components';
import {
  Settings24Regular,
  Search24Regular,
  Alert24Regular,
  Play24Regular,
  Dismiss24Regular,
} from '@fluentui/react-icons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import Settings from './components/Settings';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Dataset {
  id: number;
  nameFi: string;
  nameEn: string;
  descriptionFi: string;
  descriptionEn: string;
  unitEn: string;
  unitFi: string;
  dataPeriodEn: string;
  contentGroupsEn: string[];
}

interface DataPoint {
  datasetId: number;
  startTime: string;
  endTime: string;
  value: number;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('12px', '24px'),
    background: tokens.colorNeutralBackground1,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.colorNeutralStroke2,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('8px'),
  },
  logo: {
    fontSize: '22px',
    fontWeight: 'bold',
    fontFamily: 'Outfit, sans-serif',
    color: '#0ea5e9',
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('6px'),
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('16px'),
  },
  mainLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '320px',
    background: tokens.colorNeutralBackground1,
    borderRightWidth: '1px',
    borderRightStyle: 'solid',
    borderRightColor: tokens.colorNeutralStroke2,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('20px'),
    ...shorthands.padding('20px'),
    overflowY: 'auto',
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    ...shorthands.padding('24px'),
    ...shorthands.gap('24px'),
  },
  loginContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    background: tokens.colorNeutralBackground2,
  },
  loginCard: {
    width: '400px',
    ...shorthands.padding('32px'),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    background: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    boxShadow: tokens.shadow16,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('20px'),
  },
  categoryList: {
    display: 'flex',
    flexWrap: 'wrap',
    ...shorthands.gap('6px'),
  },
  pill: {
    ...shorthands.padding('4px', '10px'),
    ...shorthands.borderRadius('100px'),
    fontSize: '12px',
    cursor: 'pointer',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    transition: 'all 0.2s',
  },
  pillActive: {
    background: '#0ea5e9',
    color: 'white',
    ...shorthands.borderColor('#0ea5e9'),
  },
  pillInactive: {
    background: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    ':hover': {
      background: tokens.colorNeutralBackground3Hover,
    },
  },
  datasetCard: {
    ...shorthands.padding('16px'),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    background: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    cursor: 'pointer',
    transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s',
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
    ':hover': {
      transform: 'translateY(-2px)',
      ...shorthands.borderColor('#0ea5e9'),
      boxShadow: tokens.shadow8,
    },
  },
  datasetCardSelected: {
    ...shorthands.borderColor('#0ea5e9'),
    background: 'rgba(14, 165, 233, 0.04)',
    boxShadow: tokens.shadow8,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    ...shorthands.gap('12px'),
  },
  activeCollectionsList: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap('8px'),
  },
  activeItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shorthands.padding('8px', '12px'),
    background: tokens.colorNeutralBackground3,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  chartPanel: {
    background: tokens.colorNeutralBackground1,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius(tokens.borderRadiusLarge),
    ...shorthands.padding('20px'),
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    ...shorthands.gap('16px'),
  },
});

export default function App() {
  const styles = useStyles();
  const queryClient = useQueryClient();

  const [showSettings, setShowSettings] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [loginKey, setLoginKey] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [version, setVersion] = useState('Unknown');

  useEffect(() => {
    axios.get('api/version')
      .then(res => setVersion(res.data.version))
      .catch(() => setVersion('Unknown'));
  }, []);

  // 1. Fetch Login Status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const r = await axios.get('api/status');
      return r.data as { logged_in: boolean; api_key?: string };
    },
  });

  // 2. Fetch Dataset Catalog
  const { data: datasets, isLoading: datasetsLoading, error: datasetsError } = useQuery({
    queryKey: ['datasets'],
    queryFn: async () => {
      const r = await axios.get('api/datasets');
      return r.data.data as Dataset[];
    },
    enabled: !!status?.logged_in,
  });

  // 3. Fetch Active Datasets List
  const { data: activeDatasetIds = [] } = useQuery({
    queryKey: ['activeDatasets'],
    queryFn: async () => {
      const r = await axios.get('api/datasets/active');
      return r.data as number[];
    },
    enabled: !!status?.logged_in,
  });

  // 4. Fetch Preview Chart Data (last 24 hours)
  const { data: chartData = [], isLoading: chartLoading, error: chartError } = useQuery({
    queryKey: ['chartData', selectedDatasetId],
    queryFn: async () => {
      if (!selectedDatasetId) return [];
      const stop = new Date().toISOString();
      const start = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const r = await axios.get(`api/datasets/${selectedDatasetId}/data`, {
        params: { startTime: start, endTime: stop }
      });
      
      const points = (r.data.data as DataPoint[]) || [];
      return [...points].reverse().map(pt => ({
        time: new Date(pt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(pt.startTime).toLocaleDateString(),
        value: pt.value,
      }));
    },
    enabled: !!selectedDatasetId,
  });

  // Toggle Active State
  const toggleActiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const isActive = activeDatasetIds.includes(id);
      const nextActive = isActive
        ? activeDatasetIds.filter((x: number) => x !== id)
        : [...activeDatasetIds, id];
      await axios.post('api/datasets/active', nextActive);
      return nextActive;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['activeDatasets'], data);
    },
  });

  // Handle Initial Key login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginKey.trim()) return;
    setLoginLoading(true);
    setLoginError(null);
    try {
      await axios.post('api/login', { apiKey: loginKey });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
    } catch (err: any) {
      const serverMsg = typeof err.response?.data === 'string'
        ? err.response.data
        : err.response?.data?.message;
      setLoginError(serverMsg || 'Login failed. Please check your API key.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Get categories dynamically
  const categories = React.useMemo(() => {
    if (!datasets) return [];
    const set = new Set<string>();
    datasets.forEach(d => {
      if (d.contentGroupsEn) {
        d.contentGroupsEn.forEach(g => set.add(g));
      }
    });
    return Array.from(set).sort();
  }, [datasets]);

  // Get units dynamically
  const units = React.useMemo(() => {
    if (!datasets) return [];
    const set = new Set<string>();
    datasets.forEach(d => {
      if (d.unitEn) {
        const cleaned = d.unitEn.trim();
        if (cleaned) set.add(cleaned);
      }
    });
    return Array.from(set).sort();
  }, [datasets]);

  // Filter datasets
  const filteredDatasets = React.useMemo(() => {
    if (!datasets) return [];
    return datasets.filter(d => {
      const name = (d.nameEn || '').toLowerCase();
      const desc = (d.descriptionEn || '').toLowerCase();
      const nameFi = (d.nameFi || '').toLowerCase();
      const matchSearch =
        name.includes(searchQuery.toLowerCase()) ||
        desc.includes(searchQuery.toLowerCase()) ||
        nameFi.includes(searchQuery.toLowerCase()) ||
        d.id.toString() === searchQuery.trim();

      const matchCategory =
        !selectedCategory || (d.contentGroupsEn && d.contentGroupsEn.includes(selectedCategory));

      const matchUnit =
        !selectedUnit || (d.unitEn && d.unitEn.trim() === selectedUnit);

      return matchSearch && matchCategory && matchUnit;
    });
  }, [datasets, searchQuery, selectedCategory, selectedUnit]);

  const selectedDatasetDetails = React.useMemo(() => {
    if (!datasets || !selectedDatasetId) return null;
    return datasets.find(d => d.id === selectedDatasetId) || null;
  }, [datasets, selectedDatasetId]);

  if (statusLoading) {
    return (
      <div className={styles.loginContainer}>
        <Spinner size="large" label="Checking credentials..." />
      </div>
    );
  }

  // ── Render Login Screen ──────────────────────────────────────────────────────
  if (!status?.logged_in) {
    return (
      <div className={styles.loginContainer}>
        <form onSubmit={handleLogin} className={styles.loginCard}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Text size={500} weight="semibold" style={{ fontFamily: 'Outfit' }}>⚡ FingridFlow</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Fingrid Open Data InfluxDB Exporter</Text>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="api-key-input" style={{ fontSize: '13px', fontWeight: 'bold' }}>Fingrid API Key</label>
            <Input
              id="api-key-input"
              type="password"
              placeholder="Enter your api key"
              value={loginKey}
              onChange={e => setLoginKey(e.target.value)}
              style={{ width: '100%' }}
            />
            <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
              Registration is free and takes 1 minute. Create an account at <a href="https://data.fingrid.fi/" target="_blank" rel="noreferrer" style={{ color: '#0ea5e9' }}>data.fingrid.fi</a> to generate your key.
            </Text>
          </div>

          {loginError && (
            <MessageBar intent="error">
              <MessageBarBody>{loginError}</MessageBarBody>
            </MessageBar>
          )}

          <Button type="submit" appearance="primary" disabled={loginLoading} style={{ marginTop: '10px' }}>
            {loginLoading ? <Spinner size="tiny" /> : 'Save API Key'}
          </Button>
        </form>
      </div>
    );
  }

  // ── Render Main Dashboard ────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* Top Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.logo}>
            <span>⚡</span> FingridFlow
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <Badge appearance="filled" color="brand" style={{ backgroundColor: '#0e9f6e', width: 'fit-content' }}>
              Connected
            </Badge>
            <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
              {version}
            </Text>
          </div>
        </div>
        <div className={styles.headerRight}>
          <Button
            appearance="subtle"
            icon={<Settings24Regular />}
            onClick={() => setShowSettings(true)}
            title="Open Settings"
          />
        </div>
      </div>

      {/* Main Dashboard Layout */}
      <div className={styles.mainLayout}>
        
        {/* Sidebar */}
        <div className={styles.sidebar}>
          
          {/* Search */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Text size={200} weight="semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 }}>
              Search Datasets
            </Text>
            <Input
              placeholder="Search by ID or name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              contentBefore={<Search24Regular />}
              appearance="outline"
            />
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Text size={200} weight="semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 }}>
              Categories
            </Text>
            <div className={styles.categoryList}>
              <span
                className={styles.pill + ' ' + (selectedCategory === null ? styles.pillActive : styles.pillInactive)}
                onClick={() => setSelectedCategory(null)}
              >
                All
              </span>
              {categories.map(cat => (
                <span
                  key={cat}
                  className={styles.pill + ' ' + (selectedCategory === cat ? styles.pillActive : styles.pillInactive)}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* Units */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Text size={200} weight="semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 }}>
              Units
            </Text>
            <div className={styles.categoryList}>
              <span
                className={styles.pill + ' ' + (selectedUnit === null ? styles.pillActive : styles.pillInactive)}
                onClick={() => setSelectedUnit(null)}
              >
                All
              </span>
              {units.map(unit => (
                <span
                  key={unit}
                  className={styles.pill + ' ' + (selectedUnit === unit ? styles.pillActive : styles.pillInactive)}
                  onClick={() => setSelectedUnit(unit)}
                >
                  {unit}
                </span>
              ))}
            </div>
          </div>

          {/* Active list */}
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '8px', overflowY: 'hidden' }}>
            <Text size={200} weight="semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 }}>
              Selected for Export ({activeDatasetIds.length})
            </Text>
            
            <div className={styles.activeCollectionsList} style={{ overflowY: 'auto', flex: 1 }}>
              {activeDatasetIds.length === 0 ? (
                <Text size={200} style={{ color: tokens.colorNeutralForeground4, fontStyle: 'italic' }}>
                  No datasets selected. Click the switch on a dataset to start collecting.
                </Text>
              ) : (
                datasets && activeDatasetIds.map((id: number) => {
                  const d = datasets.find(x => x.id === id);
                  if (!d) return null;
                  return (
                    <div key={id} className={styles.activeItem}>
                      <div style={{ overflow: 'hidden', marginRight: '8px' }}>
                        <Text size={200} weight="semibold" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.nameEn}
                        </Text>
                        <Text size={100} style={{ color: tokens.colorNeutralForeground4 }}>
                          ID: {id} • {d.unitEn}
                        </Text>
                      </div>
                      <Switch
                        checked={true}
                        onChange={() => toggleActiveMutation.mutate(id)}
                        size="small"
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* Content Panel */}
        <div className={styles.content}>
          
          {/* Live Preview Panel */}
          {selectedDatasetId ? (
            <div className={styles.chartPanel}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <Text size={500} weight="semibold" style={{ display: 'block', fontFamily: 'Outfit' }}>
                    {selectedDatasetDetails?.nameEn}
                  </Text>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                    {selectedDatasetDetails?.descriptionEn}
                  </Text>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <Badge appearance="tint" color="brand">ID: {selectedDatasetId}</Badge>
                    <Badge appearance="tint" color="severe">Interval: {selectedDatasetDetails?.dataPeriodEn}</Badge>
                    <Badge appearance="tint" color="success">Unit: {selectedDatasetDetails?.unitEn}</Badge>
                    {selectedDatasetDetails?.contentGroupsEn?.map(cat => (
                      <Badge key={cat} appearance="outline">{cat}</Badge>
                    ))}
                  </div>
                </div>
                <Button
                  appearance="secondary"
                  icon={<Dismiss24Regular />}
                  onClick={() => setSelectedDatasetId(null)}
                >
                  Close Preview
                </Button>
              </div>

              {chartLoading ? (
                <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spinner label="Fetching last 24h real-time data..." />
                </div>
              ) : chartError ? (
                <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '8px' }}>
                  <Alert24Regular style={{ color: tokens.colorPaletteRedBorderActive, fontSize: '32px' }} />
                  <Text style={{ color: tokens.colorPaletteRedBorderActive }}>
                    Failed to load preview data. Verify your API key and connection.
                  </Text>
                </div>
              ) : chartData.length === 0 ? (
                <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: tokens.colorNeutralForeground4, fontStyle: 'italic' }}>
                    No recent data points returned by Fingrid for this dataset.
                  </Text>
                </div>
              ) : (
                <div className="chart-container" style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                      <XAxis dataKey="time" stroke="#9ca3af" fontSize={11} tickLine={false} />
                      <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#1c1e24', borderColor: '#2e303a', borderRadius: '8px', color: 'white' }}
                        labelFormatter={(label, items) => {
                          const item = items[0]?.payload;
                          return item ? `${item.date} ${label}` : label;
                        }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" name={selectedDatasetDetails?.unitEn || 'Value'} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ) : (
            <div style={{ border: `2px dashed ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusLarge, padding: '40px', textAlign: 'center', color: tokens.colorNeutralForeground4 }}>
              <Play24Regular style={{ fontSize: '36px', marginBottom: '12px', color: tokens.colorNeutralForeground3 }} />
              <Text size={300} style={{ display: 'block', fontWeight: '500' }}>Select a dataset below to view live preview chart</Text>
              <Text size={200}>Click on any card to see its real-time timeseries data from Fingrid.</Text>
            </div>
          )}

          {/* Datasets Catalog Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Text size={300} weight="semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: tokens.colorNeutralForeground3 }}>
              Dataset Catalog ({filteredDatasets.length} items)
            </Text>

            {datasetsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
                <Spinner label="Loading dataset catalog..." />
              </div>
            ) : datasetsError ? (
              <MessageBar intent="error">
                <MessageBarBody>Failed to fetch dataset catalog from Fingrid Open API. Check your API key.</MessageBarBody>
              </MessageBar>
            ) : filteredDatasets.length === 0 ? (
              <Text style={{ textAlign: 'center', color: tokens.colorNeutralForeground4, padding: '40px' }}>
                No datasets match your search filters.
              </Text>
            ) : (
              <div className={styles.grid}>
                {filteredDatasets.map(d => {
                  const isSelected = selectedDatasetId === d.id;
                  const isActive = activeDatasetIds.includes(d.id);
                  return (
                    <div
                      key={d.id}
                      className={styles.datasetCard + ' ' + (isSelected ? styles.datasetCardSelected : '')}
                      onClick={() => setSelectedDatasetId(d.id)}
                    >
                      <div className={styles.cardHeader}>
                        <div style={{ overflow: 'hidden' }}>
                          <Text size={100} style={{ color: tokens.colorNeutralForeground4, display: 'block' }}>
                            ID: {d.id}
                          </Text>
                          {d.contentGroupsEn && d.contentGroupsEn.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px', marginBottom: '6px' }}>
                              {d.contentGroupsEn.map(cat => (
                                <span key={cat} style={{ fontSize: '9px', background: tokens.colorNeutralBackground3, padding: '1px 5px', borderRadius: '4px', color: tokens.colorNeutralForeground3, border: `1px solid ${tokens.colorNeutralStroke2}`, whiteSpace: 'nowrap' }}>
                                  {cat}
                                </span>
                              ))}
                            </div>
                          )}
                          <Text size={300} weight="semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.2 }}>
                            {d.nameEn}
                          </Text>
                        </div>
                        <Switch
                          checked={isActive}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleActiveMutation.mutate(d.id);
                          }}
                          size="small"
                        />
                      </div>
                      
                      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                        <span>Period: <strong>{d.dataPeriodEn || 'N/A'}</strong></span>
                        <Badge appearance="tint" color="brand">{d.unitEn || 'Value'}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Slide-in Settings panel */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onApiKeySaved={() => {
            queryClient.invalidateQueries({ queryKey: ['status'] });
            queryClient.invalidateQueries({ queryKey: ['datasets'] });
          }}
        />
      )}
    </div>
  );
}
