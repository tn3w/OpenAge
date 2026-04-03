export interface PositioningCallbacks {
  onStatus?: (text: string) => void;
  onReady?: () => void;
}

export interface PositioningHandle {
  cancel: () => void;
}

export declare function startPositioning(
  video: HTMLVideoElement,
  callbacks: PositioningCallbacks
): PositioningHandle;
