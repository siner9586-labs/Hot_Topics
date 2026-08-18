# Methodology v1

## What Heat means

Heat is a 0–100 **internet attention index**. It is not a truth score, population poll, sentiment score, importance judgment or investment signal.

The processing order is raw source metric -> platform-local normalization -> reliability weighting -> Topic clustering -> cross-platform coverage -> Heat snapshot. Raw values from unlike platforms are never directly equated.

## Platform normalization

Rank-only sources use monotone exponential rank decay. Count-like long-tail metrics use `log1p`, 2/98-percentile winsorization and percentile ranks. Sources that expose several measures combine only measures actually available for that platform.

## Heat v1.0.0

`H = .34 PlatformStrength + .22 Breadth + .12 Volume + .12 Search + .10 Persistence + .10 Freshness`

Weights live in `packages/config` and are versioned. Breadth rewards independent source count, source-type diversity and reliability; it does not reward many same-group reposts as if they were independent platforms.

When a source fails, absent source weight is not converted to zero Heat. Available contributions are normalized among themselves while `coverage_confidence` falls according to expected vs available source weight.

## Delta, momentum and lifecycle

Primary delta is `H(t)-H(t-3h)`. A Topic without a previous snapshot is `NEW`. Momentum uses hysteresis to avoid oscillating labels. Lifecycle states are emerging/rising/spreading/peak/cooling/long_tail/revived.

## Topic clustering

1. NFKC, case, punctuation, whitespace and noise normalization.
2. Entity/number/date-sensitive fingerprints and aliases.
3. Token Jaccard + character n-grams + containment.
4. Optional multilingual embedding Provider.
5. Optional LLM arbitration only for boundary samples.

Version/date numeric conflicts receive explicit penalties. If arbitration is unavailable, ambiguous cases conservatively split rather than risk false merge.

## Evidence and anomalies

Evidence Coverage is independent-source/news-source coverage only; it is **not** a verification score. Anomaly Risk highlights single-platform spikes and suspicious repetition without deleting the Topic.
