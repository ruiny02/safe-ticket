import { PCA } from "ml-pca";
import { UMAP } from "umap-js";

export type DemoEmbeddingVariant = "current" | "fraud" | "safe" | "borderline";

export interface DemoEmbeddingPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  variant: DemoEmbeddingVariant;
}

interface RawPoint {
  id: string;
  label: string;
  variant: DemoEmbeddingVariant;
  vector: number[];
}

export interface DemoEmbeddingResult {
  pipeline: "Raw embedding -> PCA(50) -> UMAP(3)";
  points: DemoEmbeddingPoint[];
  summary: {
    nearestCluster: "fraud" | "safe" | "borderline";
    clusterCounts: {
      fraud: number;
      safe: number;
      borderline: number;
    };
    distances: {
      fraud: number;
      safe: number;
      borderline: number;
    };
  };
}

const DIMENSIONS = 64;
const COUNTS = {
  fraud: 24,
  safe: 24,
  borderline: 18,
} as const;

function mulberry32(seed: number) {
  return function nextRandom() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  return Array.from(seed).reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 1),
    1777,
  );
}

function createCenter(variant: Exclude<DemoEmbeddingVariant, "current">): number[] {
  return Array.from({ length: DIMENSIONS }, (_, index) => {
    const harmonic = Math.sin(index / 5) * 0.22 + Math.cos(index / 7) * 0.17;

    if (variant === "fraud") {
      return 1.7 + harmonic + (index % 6 === 0 ? 0.9 : 0);
    }

    if (variant === "safe") {
      return -1.5 + harmonic - (index % 5 === 0 ? 0.8 : 0);
    }

    return (index % 2 === 0 ? 0.55 : -0.48) + harmonic * 0.6;
  });
}

function sampleAroundCenter({
  baseSeed,
  center,
  index,
  noiseScale,
  variant,
}: {
  baseSeed: number;
  center: number[];
  index: number;
  noiseScale: number;
  variant: Exclude<DemoEmbeddingVariant, "current">;
}): RawPoint {
  const random = mulberry32(baseSeed + index * 97 + variant.length * 31);
  const vector = center.map((value, dimension) => {
    const noise = (random() - 0.5) * noiseScale;
    const wave = Math.sin(index * 0.9 + dimension / 8) * 0.04;
    return value + noise + wave;
  });

  return {
    id: `${variant}-${index}`,
    label: `${variant} cluster ${index + 1}`,
    variant,
    vector,
  };
}

function createCurrentVector({
  scanId,
  riskLevel,
  highlightCount,
}: {
  scanId: string;
  riskLevel: "high" | "medium" | "low" | null;
  highlightCount: number;
}): RawPoint {
  const fraudCenter = createCenter("fraud");
  const safeCenter = createCenter("safe");
  const borderlineCenter = createCenter("borderline");

  const anchor =
    riskLevel === "high"
      ? fraudCenter.map((value, index) => value * 0.72 + borderlineCenter[index] * 0.28)
      : riskLevel === "medium"
        ? borderlineCenter.map((value, index) => value * 0.7 + fraudCenter[index] * 0.18 + safeCenter[index] * 0.12)
        : safeCenter.map((value, index) => value * 0.76 + borderlineCenter[index] * 0.24);

  const random = mulberry32(hashSeed(`${scanId}-current-${highlightCount}`));
  const vector = anchor.map((value, index) => value + (random() - 0.5) * 0.11 + Math.cos(index / 6) * 0.02);

  return {
    id: scanId,
    label: "현재 게시글",
    variant: "current",
    vector,
  };
}

function normalize(values: number[], minTarget: number, maxTarget: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    return values.map(() => (minTarget + maxTarget) / 2);
  }

  return values.map((value) => {
    const ratio = (value - min) / (max - min);
    return minTarget + ratio * (maxTarget - minTarget);
  });
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Number(Math.hypot(a.x - b.x, a.y - b.y).toFixed(1));
}

export function buildDemoEmbeddingResult({
  scanId,
  riskLevel,
  highlightCount,
}: {
  scanId: string;
  riskLevel: "high" | "medium" | "low" | null;
  highlightCount: number;
}): DemoEmbeddingResult {
  const baseSeed = hashSeed(scanId);
  const fraudCenter = createCenter("fraud");
  const safeCenter = createCenter("safe");
  const borderlineCenter = createCenter("borderline");

  const rawPoints: RawPoint[] = [
    ...Array.from({ length: COUNTS.fraud }, (_, index) =>
      sampleAroundCenter({
        baseSeed,
        center: fraudCenter,
        index,
        noiseScale: 0.24,
        variant: "fraud",
      }),
    ),
    ...Array.from({ length: COUNTS.safe }, (_, index) =>
      sampleAroundCenter({
        baseSeed: baseSeed + 3000,
        center: safeCenter,
        index,
        noiseScale: 0.24,
        variant: "safe",
      }),
    ),
    ...Array.from({ length: COUNTS.borderline }, (_, index) =>
      sampleAroundCenter({
        baseSeed: baseSeed + 6000,
        center: borderlineCenter,
        index,
        noiseScale: 0.21,
        variant: "borderline",
      }),
    ),
    createCurrentVector({ scanId, riskLevel, highlightCount }),
  ];

  const matrix = rawPoints.map((point) => point.vector);
  const pca = new PCA(matrix);
  const pcaProjectedMatrix = pca.predict(matrix, { nComponents: 50 });
  const pcaProjected = typeof (pcaProjectedMatrix as { to2DArray?: () => number[][] }).to2DArray === "function"
    ? (pcaProjectedMatrix as { to2DArray: () => number[][] }).to2DArray()
    : (pcaProjectedMatrix as unknown as number[][]);

  const random = mulberry32(baseSeed + 9000);
  const umap = new UMAP({
    nComponents: 3,
    nNeighbors: 12,
    minDist: 0.22,
    spread: 1.1,
    random,
  });
  const projected = umap.fit(pcaProjected) as Array<[number, number, number]>;

  const normalizedX = normalize(
    projected.map((point) => point[0]),
    12,
    88,
  );
  const normalizedY = normalize(
    projected.map((point) => point[1]),
    12,
    88,
  );
  const normalizedZ = normalize(
    projected.map((point) => point[2]),
    12,
    88,
  );

  const points = rawPoints.map((point, index) => ({
    id: point.id,
    label: point.label,
    x: Number(normalizedX[index].toFixed(1)),
    y: Number(normalizedY[index].toFixed(1)),
    z: Number(normalizedZ[index].toFixed(1)),
    variant: point.variant,
  }));

  const currentPoint = points.find((point) => point.variant === "current");
  if (!currentPoint) {
    throw new Error("Current embedding point is missing");
  }

  const clusterCentroid = (variant: Exclude<DemoEmbeddingVariant, "current">) => {
    const cluster = points.filter((point) => point.variant === variant);
    return {
      x: cluster.reduce((total, point) => total + point.x, 0) / cluster.length,
      y: cluster.reduce((total, point) => total + point.y, 0) / cluster.length,
    };
  };

  const fraudCentroid = clusterCentroid("fraud");
  const safeCentroid = clusterCentroid("safe");
  const borderlineCentroid = clusterCentroid("borderline");
  const distances = {
    fraud: distance(currentPoint, fraudCentroid),
    safe: distance(currentPoint, safeCentroid),
    borderline: distance(currentPoint, borderlineCentroid),
  };
  const nearestCluster = (Object.entries(distances).sort((left, right) => left[1] - right[1])[0]?.[0] ??
    "fraud") as "fraud" | "safe" | "borderline";

  return {
    pipeline: "Raw embedding -> PCA(50) -> UMAP(3)",
    points,
    summary: {
      nearestCluster,
      clusterCounts: {
        fraud: COUNTS.fraud,
        safe: COUNTS.safe,
        borderline: COUNTS.borderline,
      },
      distances,
    },
  };
}
