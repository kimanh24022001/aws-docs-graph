export function gravityToNodeSize(score: number, isFocal: boolean): number {
  if (isFocal) return 12;
  return 4 + score * 8; // 4–12 range
}

export function gravityToOpacity(score: number, isFocal: boolean): number {
  if (isFocal) return 1;
  if (score < 0.3) return 0.05;
  return 0.3 + score * 0.7; // 0.3–1.0 range
}

export function gravityToLinkStrength(score: number): number {
  return score * 0.8; // 0–0.8 range
}
