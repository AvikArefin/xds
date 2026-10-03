/**
 * Readiness tracking for a slide: every part that loads or settles asynchronously (fonts,
 * images, models, screens, the environment, shadows, framing, grounds) registers a pending
 * item with a human label while it is not done. The render page's `window.xds.waiting()`
 * lists the labels; `ready` means nothing is pending.
 */
import { createContext, createElement, useContext, useLayoutEffect, type ReactNode } from "react";

export class Readiness {
  private pending = new Map<string, string>();
  private errors = new Map<string, string>();
  private listeners = new Set<() => void>();
  private scheduled = false;

  set(key: string, label: string): void {
    if (this.pending.get(key) === label) return;
    this.pending.set(key, label);
    this.emit();
  }

  clear(key: string): void {
    if (this.pending.delete(key)) this.emit();
  }

  fail(key: string, message: string): void {
    if (this.errors.get(key) === message) return;
    this.errors.set(key, message);
    this.emit();
  }

  clearError(key: string): void {
    if (this.errors.delete(key)) this.emit();
  }

  hasError(key: string): boolean {
    return this.errors.has(key);
  }

  waiting(): string[] {
    return [...new Set(this.pending.values())];
  }

  error(): string | null {
    const all = [...this.errors.values()];
    return all.length ? all.join("; ") : null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      for (const fn of this.listeners) fn();
    });
  }
}

export const ReadinessContext = createContext<Readiness | null>(null);

export function useReadiness(): Readiness {
  const r = useContext(ReadinessContext);
  if (!r) throw new Error("useReadiness outside a SlideStage");
  return r;
}

/** Keep `label` pending under `key` while `active` (and while mounted). */
export function usePending(key: string, label: string, active = true): void {
  const r = useContext(ReadinessContext);
  useLayoutEffect(() => {
    if (!r) return;
    if (active) r.set(key, label);
    else r.clear(key);
  }, [r, key, label, active]);
  useLayoutEffect(() => () => r?.clear(key), [r, key]);
}

/** A component that is pending while mounted; use as a Suspense fallback. */
export function Pending({ k, label }: { k: string; label: string }): null {
  usePending(k, label, true);
  return null;
}

/** Report an error under `key` while `message` is set. */
export function useFailure(key: string, message: string | null | undefined): void {
  const r = useContext(ReadinessContext);
  useLayoutEffect(() => {
    if (!r) return;
    if (message) r.fail(key, message);
    else r.clearError(key);
  }, [r, key, message]);
  useLayoutEffect(() => () => r?.clearError(key), [r, key]);
}

export function ReadinessProvider({ value, children }: { value: Readiness; children: ReactNode }) {
  return createElement(ReadinessContext.Provider, { value }, children);
}
