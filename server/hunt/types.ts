export interface TransportResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  text: string;
}
export interface UploadFile {
  name: string;
  field: string;
  type: string;
  bytes: Uint8Array;
}
export interface Transport {
  /** Optional execution deadline hook; basic adapters still get a bounded returned result. */
  withDeadline?(deadline:number):Transport;
  get(url: string, headers?: Record<string, string>): Promise<TransportResponse>;
  postMultipart(
    url: string,
    fields: Record<string, string>,
    file: UploadFile,
    headers?: Record<string, string>,
  ): Promise<TransportResponse>;
}
export interface HuntHit {
  engine: 'yandex' | 'bing' | 'lens' | 'web';
  pageUrl: string;
  imageUrl: string | null;
  title: string | null;
  thumbUrl: string | null;
}
export interface HuntResult {
  engine: string;
  ok: boolean;
  hits: HuntHit[];
  error?: string;
  ms: number;
}
export interface HuntImage {
  bytes: Uint8Array;
  type: string;
}
export interface HuntOptions {
  engines?: string[];
  serpApiKey?: string;
  names?: string[];
  timeoutMs?: number;
}
