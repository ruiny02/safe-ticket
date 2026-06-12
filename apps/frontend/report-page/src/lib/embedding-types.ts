export type EmbeddingPointVariant = "current" | "fraud" | "safe" | "borderline";

export interface EmbeddingPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  x3d?: number;
  y3d?: number;
  z3d?: number;
  variant: EmbeddingPointVariant;
  riskScore?: number;
}
