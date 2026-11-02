import type { Grip } from '../grip/types';

const KEY = 'pitchlab.savedGrips.v1';

function isGrip(x: unknown): x is Grip {
  const g = x as Grip;
  return !!g && typeof g.id === 'string' && typeof g.name === 'string' && !!g.fingers && Array.isArray(g.seamQuat) && g.seamQuat.length === 4;
}

export function loadSavedGrips(): Grip[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isGrip).map((g) => ({ ...g, residualSpinOverride: g.residualSpinOverride ?? null })) : [];
  } catch {
    return [];
  }
}

export function persistSavedGrips(grips: Grip[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(grips));
  } catch {
    /* storage unavailable (private mode) — saves last for this session only */
  }
}
