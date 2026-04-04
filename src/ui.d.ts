export declare function resolveTheme(
  theme: "light" | "dark" | "auto"
): "light" | "dark";

export declare function watchTheme(
  host: HTMLElement,
  theme: "light" | "dark" | "auto"
): (() => void) | undefined;

export declare function checkboxTemplate(
  labelText: string
): string;

export declare function heroTemplate(
  statusText: string
): string;

export declare function challengeTemplate(): string;

export declare function errorStepTemplate(
  message: string
): string;

export declare function resultTemplate(
  outcome: "fail" | "retry",
  message: string
): string;

export declare function errorBannerTemplate(
  message: string
): string;

export declare const FACE_SVG: string;
export declare const FACE_ICON_SVG: string;
export declare const FACE_GUIDE_SVG: string;
export declare const CHECK_SVG: string;
export declare const CLOSE_SVG: string;
export declare const RETRY_SVG: string;
export declare const SPINNER_SVG: string;
export declare const SHIELD_SVG: string;
export declare const STYLES: string;
