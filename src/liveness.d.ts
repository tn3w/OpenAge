import { TrackingResult } from "./face-tracker";

export interface LivenessTask {
  id: string;
  instruction: string;
  check: (history: MotionEntry[]) => boolean;
}

export interface MotionEntry {
  timestamp: number;
  headPose: { yaw: number; pitch: number; roll: number };
  blendshapes: Record<string, number>;
  boundingBox: { area: number; [key: string]: number };
}

export interface LivenessSession {
  tasks: LivenessTask[];
  currentIndex: number;
  history: MotionEntry[];
  taskStartTime: number;
  completedTasks: number;
  requiredPasses: number;
  failed: boolean;
  failReason: string | null;
}

export declare function pickTasks(
  count?: number
): LivenessTask[];

export declare function createSession(
  tasks?: LivenessTask[]
): LivenessSession;

export declare function processFrame(
  session: LivenessSession,
  trackingResult: TrackingResult
): void;

export declare function isComplete(
  session: LivenessSession
): boolean;

export declare function isPassed(
  session: LivenessSession
): boolean;

export declare function currentInstruction(
  session: LivenessSession
): string | null;

export declare function currentTaskId(
  session: LivenessSession
): string | null;

export declare function progress(
  session: LivenessSession
): number;

export declare function isSuspicious(
  history: MotionEntry[]
): boolean;
