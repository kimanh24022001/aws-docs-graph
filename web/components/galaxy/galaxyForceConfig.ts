export interface ForceConfig {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
}

export const LEVEL_FORCE_CONFIG: Record<string, ForceConfig> = {
  universe: { chargeStrength: -120, linkDistance: 60, linkStrength: 0.3 },
  cluster: { chargeStrength: -80, linkDistance: 40, linkStrength: 0.5 },
  service: { chargeStrength: -60, linkDistance: 30, linkStrength: 0.6 },
  concept: { chargeStrength: -40, linkDistance: 20, linkStrength: 0.7 },
  gravity: { chargeStrength: -100, linkDistance: 50, linkStrength: 0.8 },
};
