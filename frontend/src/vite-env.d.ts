/// <reference types="vite/client" />

declare module "../report.js" {
  export function report(
    error: unknown,
    context: { region: string; screenId: string | null; elementKey?: string },
  ): void;
}
