export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

export interface TrackingResult {
  faceCount: number;
  timestampMs: number;
  landmarks?: unknown[];
  blendshapes?: Record<string, number>;
  headPose?: HeadPose;
  boundingBox?: BoundingBox;
}

export declare function loadVision(): Promise<unknown>;

export declare function loadModel(): Promise<Uint8Array>;

export declare function initTracker(
  modelBuffer: ArrayBuffer | Uint8Array
): Promise<void>;

export declare function track(
  video: HTMLVideoElement,
  timestampMs: number
): TrackingResult | null;

export declare function destroyTracker(): void;

export declare function isTrackerReady(): boolean;
