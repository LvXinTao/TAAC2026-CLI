export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

export interface DirectClient {
  directCookieHeader: string;
}

export interface TrainingJob {
  taskID: string;
  id: string;
  name: string;
  description: string;
  status: string;
  jzStatus: string;
  updateTime: string;
}

export interface JobInstance {
  id: string;
  name?: string;
  status?: string;
}

export interface TrainFile {
  name: string;
  path: string;
  url?: string;
  size?: number;
  mtime?: number;
}

export interface JobDetail {
  data?: {
    trainFiles?: TrainFile[];
    train_files?: TrainFile[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface JobRecord {
  jobId: string;
  jobInternalId: string;
  name: string;
  description: string;
  status: string;
  jzStatus: string;
  updateTime: string;
  rawJob: unknown;
  rawJobDetail?: unknown;
  trainFiles?: TrainFile[];
  code?: {
    path: string;
    files: number;
    saved: number;
    downloadVersion?: number;
    error?: string;
  };
  instancesById: Record<string, InstanceRecord>;
  sync?: {
    skippedDeepSync: boolean;
    skipReason?: string;
    lastSeenAt: string;
    lastDeepFetchedAt?: string;
  };
}

export interface InstanceRecord {
  instanceId: string;
  rawInstance?: unknown;
  metrics?: Record<string, unknown>;
  checkpoints?: unknown[];
  metricSummary?: Record<string, unknown>;
  log?: { path: string; lines: number };
  error?: string | null;
}

export interface MetricRow {
  metric: string;
  chart: string;
  chartIndex: number;
  series: string;
  step: string | number;
  value: unknown;
}

export interface CheckpointRow {
  jobId: string;
  jobInternalId: string;
  jobName: string;
  instanceId: string;
  ckpt: string;
  ckptFileSize?: number;
  createTime?: string;
  deleteTime?: string;
  status?: string;
}

export interface EvaluationTask {
  id: string;
  name: string;
  mould_id: string;
  status: string;
  modifier: string;
  create_time: string;
  update_time: string;
  score?: number;
  results?: { auc?: number };
  infer_time?: number;
  error_msg?: string;
  files?: unknown[];
}

export interface SubmitManifest {
  name: string;
  description: string;
  templateJobInternalId?: string;
  templateJobUrl?: string;
  gitHead?: string;
  gitDirty?: boolean;
  files: {
    codeZip?: string;
    config?: string;
    runSh?: string;
    generic?: Array<{ localPath: string; remoteName: string }>;
  };
  run?: boolean;
  message?: string;
}

export interface CosToken {
  id: string;
  key: string;
  Token: string;
}

export interface DownloadValidation {
  bytes: number;
  contentType: string;
}

export interface ConfigChange {
  type: "added" | "removed" | "changed";
  path: string;
  before: unknown;
  after: unknown;
}

export interface ConfigDiffResult {
  oldFile: string;
  newFile: string;
  summary: { total: number; added: number; removed: number; changed: number };
  changes: ConfigChange[];
}

export interface CheckpointInfo {
  name?: string;
  ckpt?: string;
  createTime?: string;
  [key: string]: unknown;
}

export interface ReleaseCkptRequest {
  name: string;
  desc: string;
  ckpt: string;
}

