import { describe, expect, it } from "vitest";

import {
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
});
