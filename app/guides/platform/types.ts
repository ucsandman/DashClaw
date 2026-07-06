export type ItemStatus = 'stable' | 'beta' | 'experimental' | 'archived' | 'deprecated';

export interface GuideItem {
  id: string;
  name: string;
  kind: string;
  status: ItemStatus;
  statusEvidence?: string;
  interface: string;
  purpose?: string;
  auth?: string;
  inputs?: Record<string, unknown> | null;
  response?: string;
  errors?: string;
  gotchas?: string;
  file?: string;
  clickPath?: string;
  endpoint?: string;
  envVars?: string[];
  required?: boolean | string;
}

export interface GuideArea {
  id: string;
  kind: string;
  title: string;
  segment?: string;
  package?: Record<string, unknown>;
  config?: Record<string, unknown>;
  items: GuideItem[];
}

export interface HttpCapture {
  id: string;
  method: string;
  path: string;
  command: string;
  request?: string | null;
  status: string;
  response: string;
  truncated?: boolean;
  keyKind?: string;
  capturedAt?: string;
}

export interface McpCapture {
  id: string;
  tool: string;
  request: Record<string, unknown>;
  response: string;
  note?: string;
  verified?: string;
}

export interface SdkCapture {
  id: string;
  code: string;
  response?: string;
  error?: string;
  verified?: string;
}

export interface GuideData {
  meta: {
    generatedAt: string;
    archiveNote?: string;
    counts: Record<string, number>;
  };
  liveExamples: {
    http: HttpCapture[];
    mcp: McpCapture[];
    sdkNode: SdkCapture[];
    sdkPython: SdkCapture[];
  };
  areas: GuideArea[];
}
