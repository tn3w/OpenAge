export interface VMSession {
  wasmJs: string;
  wasmBin: string;
  loaderJs: string;
  challengeVmbc: string;
  rounds: number;
  exports: Record<string, string>;
  models: Record<
    string,
    { url: string }
  >;
  [key: string]: unknown;
}

export interface VMBridge {
  trackFace(): string;
  captureFrame(): string;
}

export declare function initVM(
  session: VMSession
): Promise<void>;

export declare function decryptModel(
  session: VMSession,
  modelId: string
): Promise<ArrayBuffer>;

export declare function setFaceData(
  faceData: unknown
): void;

export declare function setChallengeParams(
  params: unknown
): void;

export declare function registerBridge(
  bridge: VMBridge
): void;

export declare function unregisterBridge(): void;

export declare function executeChallenge(): Uint8Array;

export declare function toBase64(
  bytes: Uint8Array
): string;

export declare function destroyVM(): void;

export declare function isVMLoaded(): boolean;

export declare function ensureModels(
  session: VMSession,
  onProgress?: (fraction: number) => void
): Promise<void>;

export declare function getMediaPipeModelBuffer(
  session: VMSession
): Promise<ArrayBuffer>;

export declare function clearModelCache(): void;
