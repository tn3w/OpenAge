import { WidgetParams } from "./widget";
import { TokenPayload } from "./transport";

export type OpenAgeEvent =
  | "verified"
  | "expired"
  | "error"
  | "opened"
  | "closed";

export interface OpenAge {
  render(
    container: string | HTMLElement,
    params?: WidgetParams
  ): string;

  open(params?: WidgetParams): string;

  bind(
    element: string | HTMLElement,
    params?: WidgetParams
  ): () => void;

  reset(widgetId: string): void;
  remove(widgetId: string): void;
  getToken(widgetId: string): string | null;
  execute(widgetId: string): void;

  challenge(params?: WidgetParams): Promise<string>;

  on(
    event: OpenAgeEvent,
    handler: (...args: any[]) => void
  ): void;

  off(
    event: OpenAgeEvent,
    handler: (...args: any[]) => void
  ): void;

  once(
    event: OpenAgeEvent,
    handler: (...args: any[]) => void
  ): void;

  verify(token: string): Promise<TokenPayload | null>;
  decode(token: string): TokenPayload | null;

  version: string;
}

declare const OpenAge: OpenAge;
export default OpenAge;

export {
  render,
  open,
  bind,
  reset,
  remove,
  getToken,
  execute,
  challenge,
  on,
  off,
  once,
} from "./index";

export { verify, decode } from "./transport";
export { version } from "./constants";

export type { WidgetParams } from "./widget";
export type { TokenPayload } from "./transport";
export type { TrackingResult, HeadPose, BoundingBox } from "./face-tracker";
export type { LivenessSession, LivenessTask } from "./liveness";
export type { AgeResult } from "./age-estimator";
export type { Transport, TransportResult } from "./transport";

declare global {
  interface Window {
    openage?: {
      sitekey?: string;
      server?: string;
      mode?: "serverless" | "sitekey" | "custom";
      layout?: "widget" | "inline" | "embed" | "embedded";
      locale?: string;
      theme?: "light" | "dark" | "auto";
      render?: "explicit";
    };
    OpenAge: OpenAge;
  }
}
