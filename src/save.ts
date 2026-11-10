export interface LevelProgress {
  best: number;
  stars: number;
  plays: number;
}

export interface SaveData {
  version: 1;
  levels: Record<string, LevelProgress>;
  speed: number;
  muted: boolean;
}

const KEY = 'right-of-way.save.v1';

const DEFAULT: SaveData = { version: 1, levels: {}, speed: 3, muted: false };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, levels: {} };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return { ...DEFAULT, ...parsed, levels: parsed.levels ?? {} };
  } catch {
    return { ...DEFAULT, levels: {} };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress is session-only */
  }
}

export function recordResult(data: SaveData, levelId: string, score: number, stars: number): LevelProgress {
  const prev = data.levels[levelId] ?? { best: -Infinity, stars: 0, plays: 0 };
  const next: LevelProgress = {
    best: Math.max(prev.best, score),
    stars: Math.max(prev.stars, stars),
    plays: prev.plays + 1,
  };
  data.levels[levelId] = next;
  writeSave(data);
  return next;
}
