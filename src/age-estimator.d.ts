export interface AgeResult {
  age: number;
  gender: string;
  confidence: number;
}

export declare function initAgeEstimator(): Promise<void>;

export declare function estimateAge(
  canvas: HTMLCanvasElement
): Promise<AgeResult | null>;

export declare function estimateAgeBurst(
  frames: HTMLCanvasElement[]
): Promise<AgeResult[]>;

export declare function isInitialized(): boolean;
