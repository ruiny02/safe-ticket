# Risk-space PLS Component Report

## Purpose

This note summarizes how much information is captured by PLS components when predicting `cases.risk_score` from ticket-listing embeddings.

The experiment compares two settings:

1. `raw normalized 768d embedding -> PLS(50)`
2. `raw normalized 768d embedding -> PCA(64) -> PLS(50)`

The active model was not changed. These numbers are analysis-only.

## Data

- Samples: `988`
- Raw embedding dimension: `768`
- PCA preprocessor: `64` components
- PCA(64) input variance retained from raw embedding: `89.73%`
- Target: continuous `cases.risk_score`

## How To Read The Table

- `X cumulative explained` means how much of the embedding-side input structure is reconstructed by the first `k` PLS components.
- `Y risk cumulative explained` means how much of the risk-score target variance is explained by the first `k` PLS components.
- High `Y` with low `X` means the component is highly risk-oriented, not a general semantic summary of the whole embedding space.

## Summary

The raw 768d PLS model keeps adding small amounts of risk-signal information after the first component. Component 1 already explains `87.15%` of risk-score variance, but component 10 reaches `96.18%`, and component 50 reaches `98.63%`.

The PCA(64) -> PLS result is different. The first PLS component already explains `94.51%` of risk-score variance, while later components add almost no additional risk explanation. This suggests PCA compresses most risk-predictive information into one dominant direction for this dataset.

For deterministic risk scoring, a single PLS risk axis is easier to explain. For similar-case retrieval, raw PLS(10) or raw PLS(20) may preserve more secondary structure than PCA(64) -> PLS.

## Key Checkpoints

| Model | Component | X cumulative explained | Y risk cumulative explained |
| --- | ---: | ---: | ---: |
| Raw 768d -> PLS | 1 | 4.16% | 87.15% |
| Raw 768d -> PLS | 10 | 40.28% | 96.18% |
| Raw 768d -> PLS | 20 | 64.78% | 97.26% |
| Raw 768d -> PLS | 50 | 83.75% | 98.63% |
| PCA(64) -> PLS | 1 | 1.56% | 94.51% |
| PCA(64) -> PLS | 10 | 15.63% | 94.51% |
| PCA(64) -> PLS | 20 | 31.25% | 94.51% |
| PCA(64) -> PLS | 50 | 73.44% | 94.65% |

## Raw 768d Normalized Embedding -> PLS(50)

| Component | X cumulative explained | Y risk cumulative explained |
| ---: | ---: | ---: |
| 1 | 4.16% | 87.15% |
| 2 | 9.34% | 91.10% |
| 3 | 14.73% | 92.91% |
| 4 | 19.30% | 93.94% |
| 5 | 23.57% | 94.44% |
| 6 | 27.56% | 94.89% |
| 7 | 30.14% | 95.53% |
| 8 | 34.45% | 95.73% |
| 9 | 36.87% | 96.00% |
| 10 | 40.28% | 96.18% |
| 11 | 44.02% | 96.30% |
| 12 | 46.41% | 96.48% |
| 13 | 49.09% | 96.60% |
| 14 | 51.21% | 96.74% |
| 15 | 53.56% | 96.86% |
| 16 | 56.34% | 96.93% |
| 17 | 58.71% | 97.02% |
| 18 | 60.45% | 97.13% |
| 19 | 63.10% | 97.18% |
| 20 | 64.78% | 97.26% |
| 21 | 66.91% | 97.32% |
| 22 | 68.70% | 97.38% |
| 23 | 70.21% | 97.44% |
| 24 | 71.93% | 97.50% |
| 25 | 73.79% | 97.55% |
| 26 | 74.35% | 97.65% |
| 27 | 75.26% | 97.71% |
| 28 | 75.96% | 97.79% |
| 29 | 76.69% | 97.84% |
| 30 | 77.18% | 97.91% |
| 31 | 77.58% | 97.99% |
| 32 | 77.96% | 98.05% |
| 33 | 78.26% | 98.12% |
| 34 | 78.57% | 98.17% |
| 35 | 78.90% | 98.22% |
| 36 | 79.23% | 98.26% |
| 37 | 79.57% | 98.30% |
| 38 | 80.07% | 98.33% |
| 39 | 80.50% | 98.36% |
| 40 | 80.81% | 98.39% |
| 41 | 81.08% | 98.43% |
| 42 | 81.37% | 98.46% |
| 43 | 81.65% | 98.48% |
| 44 | 82.04% | 98.50% |
| 45 | 82.33% | 98.53% |
| 46 | 82.71% | 98.55% |
| 47 | 83.03% | 98.57% |
| 48 | 83.27% | 98.59% |
| 49 | 83.48% | 98.61% |
| 50 | 83.75% | 98.63% |

## PCA(64) -> PLS(50)

| Component | X cumulative explained | Y risk cumulative explained |
| ---: | ---: | ---: |
| 1 | 1.56% | 94.51% |
| 2 | 3.13% | 94.51% |
| 3 | 4.69% | 94.51% |
| 4 | 6.25% | 94.51% |
| 5 | 7.81% | 94.51% |
| 6 | 9.38% | 94.51% |
| 7 | 10.94% | 94.51% |
| 8 | 12.50% | 94.51% |
| 9 | 14.06% | 94.51% |
| 10 | 15.63% | 94.51% |
| 11 | 17.19% | 94.51% |
| 12 | 18.75% | 94.51% |
| 13 | 20.31% | 94.51% |
| 14 | 21.88% | 94.51% |
| 15 | 23.44% | 94.51% |
| 16 | 25.00% | 94.51% |
| 17 | 26.56% | 94.51% |
| 18 | 28.13% | 94.51% |
| 19 | 29.69% | 94.51% |
| 20 | 31.25% | 94.51% |
| 21 | 32.81% | 94.51% |
| 22 | 32.81% | 94.58% |
| 23 | 34.38% | 94.58% |
| 24 | 35.94% | 94.58% |
| 25 | 37.50% | 94.58% |
| 26 | 39.06% | 94.58% |
| 27 | 40.63% | 94.58% |
| 28 | 42.19% | 94.58% |
| 29 | 43.75% | 94.58% |
| 30 | 45.31% | 94.58% |
| 31 | 46.88% | 94.58% |
| 32 | 48.44% | 94.58% |
| 33 | 48.44% | 94.63% |
| 34 | 50.00% | 94.63% |
| 35 | 51.56% | 94.63% |
| 36 | 53.13% | 94.63% |
| 37 | 54.69% | 94.63% |
| 38 | 56.25% | 94.63% |
| 39 | 57.81% | 94.63% |
| 40 | 59.38% | 94.63% |
| 41 | 60.94% | 94.63% |
| 42 | 62.50% | 94.63% |
| 43 | 62.50% | 94.65% |
| 44 | 64.06% | 94.65% |
| 45 | 65.63% | 94.65% |
| 46 | 67.19% | 94.65% |
| 47 | 68.75% | 94.65% |
| 48 | 70.31% | 94.65% |
| 49 | 71.88% | 94.65% |
| 50 | 73.44% | 94.65% |

## Interpretation

`Raw 768d -> PLS(50)` is better if the goal is to preserve secondary retrieval structure. It gradually captures more embedding-side structure and slowly improves risk target explanation after component 1.

`PCA(64) -> PLS(50)` is cleaner if the goal is a single deterministic risk axis. It concentrates almost all risk-target explanation into component 1, but later PLS components are less useful for risk-aware cosine retrieval.

Recommended split:

- Risk score: keep a single PLS risk axis.
- Similar-case retrieval: consider weighted raw PLS(10) or raw PLS(20), with component weights based on Y incremental explained variance.
- Visualization: keep `x = risk score axis`, and use residual UMAP/PCA for `y/z`.

## Figure

See `risk-space-pls-explained-variance.svg`.
