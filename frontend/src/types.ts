export type TabKey = 'explore' | 'collect' | 'settings';

/** One entry of Fingrid's variable catalog. The backend passes Fingrid's own
 *  camelCase shape straight through, so these names mirror the upstream API. */
export interface Dataset {
  id: number;
  nameFi: string;
  nameEn: string;
  descriptionFi: string | null;
  descriptionEn: string | null;
  unitFi: string | null;
  unitEn: string | null;
  dataPeriodFi: string | null;
  dataPeriodEn: string | null;
  contentGroupsFi: string[] | null;
  contentGroupsEn: string[] | null;
}

export interface DataPoint {
  datasetId: number;
  startTime: string;
  endTime: string;
  value: number;
}

export interface AuthStatus {
  logged_in: boolean;
  api_key?: string | null;
}

export interface InfluxConfig {
  url: string;
  token: string;
  org: string;
  bucket: string;
  enabled: boolean;
  interval_minutes: number;
}

export interface InfluxStatus {
  enabled: boolean;
  last_sync: string | null;
  next_sync: string | null;
  error: string | null;
}

export interface SyncResult {
  ok: boolean;
  points: number;
  message: string;
}
