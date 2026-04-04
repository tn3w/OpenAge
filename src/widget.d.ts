export interface WidgetParams {
  sitekey?: string;
  server?: string;
  mode?: "serverless" | "sitekey" | "custom";
  theme?: "light" | "dark" | "auto";
  size?: "compact" | "normal" | "invisible";
  action?: string;
  minAge?: number;
  callback?: (token: string) => void;
  errorCallback?: (error: string | Error) => void;
  expiredCallback?: () => void;
  closeCallback?: () => void;
}

export declare class Widget {
  id: string;
  params: WidgetParams;
  state: string;
  token: string | null;
  onChallenge: ((widget: Widget) => void) | null;
  onStartClick: (() => void) | null;

  constructor(
    container: string | HTMLElement,
    params: WidgetParams
  );

  startChallenge(): void;
  openPopup(): HTMLVideoElement | null;
  openModal(): HTMLVideoElement | null;
  closePopup(): void;
  showHero(statusText: string): void;
  showReady(): void;
  showCamera(): HTMLVideoElement | null;
  showLiveness(): void;
  setHeroStatus(text: string): void;
  setVideoStatus(text: string): void;
  setInstruction(text: string): void;
  setStatus(text: string): void;
  setProgress(fraction: number): void;
  setTask(taskId: string | null): void;
  showActions(label: string): void;
  hideActions(): void;
  showResult(
    outcome: "pass" | "fail" | "retry",
    message: string
  ): void;
  showError(message: string): void;
  setErrorCountdown(seconds: number): void;
  clearError(): void;
  setState(state: string): void;
  getToken(): string | null;
  reset(): void;
  destroy(): void;
}

export declare function createModalWidget(
  params: WidgetParams
): Widget;
