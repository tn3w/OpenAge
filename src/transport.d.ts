export interface TokenPayload {
  ageConfirmed: boolean;
  estimatedAge: number;
  minAge: number;
  mode: string;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export declare function createToken(
  payload: Record<string, unknown>
): Promise<string>;

export declare function verifyToken(
  token: string
): Promise<TokenPayload | null>;

export declare function decodeToken(
  token: string
): TokenPayload | null;

export interface TransportResult {
  success: boolean;
  ageConfirmed: boolean;
  token?: string | null;
  error?: string;
}

export interface ServerSession {
  sessionId: string;
  transport: "websocket" | "poll";
  [key: string]: unknown;
}

export interface Transport {
  verify(
    payload: Record<string, unknown>
  ): Promise<TransportResult>;
  createSession?(): Promise<ServerSession>;
  openChannel?(): void;
  receive?(): Promise<unknown>;
  send?(data: unknown): Promise<void>;
  sendAndReceive?(
    data: unknown
  ): Promise<unknown | null>;
  getSession?(): ServerSession | null;
  close(): void;
}

export interface TransportOptions {
  server?: string;
  sitekey?: string;
  action?: string;
  minAge?: number;
}

export declare function createTransport(
  mode: "serverless" | "sitekey" | "custom",
  options?: TransportOptions
): Transport;
