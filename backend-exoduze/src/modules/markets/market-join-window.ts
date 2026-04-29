import { HttpError } from "../../lib/http-error.js";

export type MarketJoinWindowConfig = {
  joinWindowRatio: number;
  minJoinWindowHours: number;
  maxJoinWindowHours: number;
};

export function buildConfiguredJoinDeadlineAt(input: {
  opensAt: string;
  decisionCutoffAt: string;
  closesAt: string;
  resolvesAt: string | null;
  config: MarketJoinWindowConfig;
}) {
  const opensAtMs = Date.parse(input.opensAt);
  const decisionCutoffAtMs = Date.parse(input.decisionCutoffAt);
  const closesAtMs = Date.parse(input.closesAt);
  const resolvesAtMs = input.resolvesAt ? Date.parse(input.resolvesAt) : null;

  if (
    [opensAtMs, decisionCutoffAtMs, closesAtMs].some((value) =>
      Number.isNaN(value),
    )
  ) {
    throw new HttpError(
      400,
      "INVALID_MARKET_TIMING",
      "Market timestamps must be valid ISO dates.",
    );
  }

  if (resolvesAtMs !== null && Number.isNaN(resolvesAtMs)) {
    throw new HttpError(
      400,
      "INVALID_MARKET_TIMING",
      "resolves_at must be a valid ISO date.",
    );
  }

  const marketEndMs = resolvesAtMs ?? closesAtMs;
  const durationMs = Math.max(0, marketEndMs - opensAtMs);
  const desiredJoinWindowMs = durationMs * input.config.joinWindowRatio;
  const minJoinWindowMs = input.config.minJoinWindowHours * 60 * 60_000;
  const maxJoinWindowMs = input.config.maxJoinWindowHours * 60 * 60_000;
  const boundedJoinWindowMs = Math.min(
    maxJoinWindowMs,
    Math.max(minJoinWindowMs, desiredJoinWindowMs),
  );
  const upperBoundMs = Math.min(
    decisionCutoffAtMs,
    closesAtMs,
    resolvesAtMs ?? Number.POSITIVE_INFINITY,
  );
  const joinDeadlineAtMs = Math.min(
    opensAtMs + boundedJoinWindowMs,
    upperBoundMs,
  );

  return new Date(Math.max(opensAtMs, joinDeadlineAtMs)).toISOString();
}
