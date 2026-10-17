import { useSyncExternalStore } from 'react';

/** Subtitles are a personal choice, so this lives in the browser and is never synced to the room. */
const KEY = 'waitup:captions';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

let on = read();

export function captionsOn(): boolean {
  return on;
}

export function setCaptions(value: boolean): void {
  on = value;
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    /* only this session remembers it */
  }
  for (const fn of listeners) fn();
}

export function subscribeCaptions(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useCaptions(): boolean {
  return useSyncExternalStore(subscribeCaptions, captionsOn);
}
