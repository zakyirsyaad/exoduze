import assert from "node:assert/strict";
import test from "node:test";

import { hasPublishedMarketTimingChange } from "./market-onchain-timing.js";

test("published market timing guard allows equivalent timestamps", () => {
  assert.equal(
    hasPublishedMarketTimingChange(
      {
        opensAt: "2026-04-28 08:05:43.631+00",
        joinDeadlineAt: "2026-04-28 14:05:43.631+00",
        decisionCutoffAt: "2026-04-29 08:05:43.631+00",
        closesAt: "2026-04-29 08:05:43.631+00",
        resolvesAt: null,
      },
      {
        opensAt: "2026-04-28T08:05:43.631Z",
        joinDeadlineAt: "2026-04-28T14:05:43.631Z",
        decisionCutoffAt: "2026-04-29T08:05:43.631Z",
        closesAt: "2026-04-29T08:05:43.631Z",
        resolvesAt: null,
      },
    ),
    false,
  );
});

test("published market timing guard rejects changed join deadline", () => {
  assert.equal(
    hasPublishedMarketTimingChange(
      {
        opensAt: "2026-04-28T08:05:43.631Z",
        joinDeadlineAt: "2026-04-28T09:05:43.631Z",
        decisionCutoffAt: "2026-04-29T08:05:43.631Z",
        closesAt: "2026-04-29T08:05:43.631Z",
        resolvesAt: null,
      },
      {
        opensAt: "2026-04-28T08:05:43.631Z",
        joinDeadlineAt: "2026-04-28T14:05:43.631Z",
        decisionCutoffAt: "2026-04-29T08:05:43.631Z",
        closesAt: "2026-04-29T08:05:43.631Z",
        resolvesAt: null,
      },
    ),
    true,
  );
});
