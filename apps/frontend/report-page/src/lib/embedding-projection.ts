export type EmbeddingProjectionVariant = "current" | "fraud" | "safe" | "borderline";

export interface EmbeddingProjectionPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  x3d?: number;
  y3d?: number;
  z3d?: number;
  variant: EmbeddingProjectionVariant;
  riskScore?: number;
}

export interface EmbeddingCamera {
  pitch: number;
  yaw: number;
  zoom: number;
}

export interface ProjectedEmbeddingPoint extends EmbeddingProjectionPoint {
  screenX: number;
  screenY: number;
  depth: number;
  opacity: number;
  radius: number;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function normalizeCoordinate(value: number) {
  return (value - 50) / 50;
}

function getPointRadius(variant: EmbeddingProjectionVariant) {
  return variant === "current" ? 2.55 : 1.28;
}

export function buildStarPolygonPoints({
  centerX,
  centerY,
  outerRadius,
  innerRadius,
}: {
  centerX: number;
  centerY: number;
  outerRadius: number;
  innerRadius: number;
}): string {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI / 5);
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    return `${x.toFixed(3)},${y.toFixed(3)}`;
  }).join(" ");
}

export function projectEmbeddingPoint3D(
  point: EmbeddingProjectionPoint,
  camera: EmbeddingCamera,
): ProjectedEmbeddingPoint {
  const pitch = degreesToRadians(camera.pitch);
  const yaw = degreesToRadians(camera.yaw);
  const zoom = camera.zoom;
  const centeredX = normalizeCoordinate(point.x3d ?? point.x);
  const centeredY = normalizeCoordinate(point.y3d ?? point.y);
  const centeredZ = normalizeCoordinate(point.z3d ?? point.z);

  const yawX = centeredX * Math.cos(yaw) + centeredZ * Math.sin(yaw);
  const yawZ = -centeredX * Math.sin(yaw) + centeredZ * Math.cos(yaw);
  const pitchY = centeredY * Math.cos(pitch) - yawZ * Math.sin(pitch);
  const pitchZ = centeredY * Math.sin(pitch) + yawZ * Math.cos(pitch);

  return {
    ...point,
    screenX: Number((50 + yawX * 33 * zoom).toFixed(3)),
    screenY: Number((50 + pitchY * 33 * zoom).toFixed(3)),
    depth: Number(pitchZ.toFixed(4)),
    opacity: Number((0.54 + Math.max(0, Math.min(1, (pitchZ + 1.4) / 2.8)) * 0.42).toFixed(3)),
    radius: getPointRadius(point.variant),
  };
}

export function projectEmbeddingPoints3D(
  points: EmbeddingProjectionPoint[],
  camera: EmbeddingCamera,
): ProjectedEmbeddingPoint[] {
  return points
    .map((point) => projectEmbeddingPoint3D(point, camera))
    .sort((left, right) => left.depth - right.depth);
}

export function projectEmbeddingAxis3D(
  axis: "x" | "y" | "z",
  camera: EmbeddingCamera,
): { x1: number; y1: number; x2: number; y2: number; depth: number } {
  const axisPoint = {
    id: axis,
    label: axis,
    variant: "safe" as const,
    x: axis === "x" ? 88 : 50,
    y: axis === "y" ? 12 : 50,
    z: axis === "z" ? 88 : 50,
  };
  const origin = projectEmbeddingPoint3D(
    { ...axisPoint, id: `${axis}-origin`, x: 50, y: 50, z: 50 },
    camera,
  );
  const target = projectEmbeddingPoint3D(axisPoint, camera);

  return {
    x1: origin.screenX,
    y1: origin.screenY,
    x2: target.screenX,
    y2: target.screenY,
    depth: target.depth,
  };
}
