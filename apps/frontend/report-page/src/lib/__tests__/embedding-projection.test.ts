import { describe, expect, it } from "vitest";

import {
  buildStarPolygonPoints,
  projectEmbeddingPoint3D,
  projectEmbeddingPoints3D,
  type EmbeddingProjectionPoint,
} from "../embedding-projection";

const currentPoint: EmbeddingProjectionPoint = {
  id: "scan_current",
  label: "현재 게시글",
  x: 62,
  y: 38,
  z: 74,
  variant: "current",
};

describe("embedding 3D projection", () => {
  it("keeps point radius invariant across camera rotation and zoom", () => {
    const firstView = projectEmbeddingPoint3D(currentPoint, {
      pitch: -28,
      yaw: 35,
      zoom: 0.85,
    });
    const secondView = projectEmbeddingPoint3D(currentPoint, {
      pitch: -62,
      yaw: 128,
      zoom: 1.55,
    });

    expect(firstView.radius).toBe(secondView.radius);
  });

  it("sorts back points before front points for SVG painting order", () => {
    const projected = projectEmbeddingPoints3D(
      [
        { ...currentPoint, id: "front", z: 92 },
        { ...currentPoint, id: "back", z: 8 },
      ],
      { pitch: 0, yaw: 0, zoom: 1 },
    );

    expect(projected.map((point) => point.id)).toEqual(["back", "front"]);
  });

  it("uses dedicated 3D coordinates when backend provides separate UMAP(3) values", () => {
    const projected = projectEmbeddingPoint3D(
      {
        ...currentPoint,
        x: 10,
        y: 10,
        z: 8,
        x3d: 90,
        y3d: 70,
        z3d: 92,
      },
      { pitch: 0, yaw: 0, zoom: 1 },
    );

    expect(projected.screenX).toBe(76.4);
    expect(projected.screenY).toBe(63.2);
    expect(projected.depth).toBe(0.84);
  });

  it("builds a five-point star polygon for the current scan marker", () => {
    const points = buildStarPolygonPoints({ centerX: 50, centerY: 40, outerRadius: 5, innerRadius: 2.2 });

    expect(points.split(" ")).toHaveLength(10);
    expect(points).toContain("50.000,35.000");
  });
});
