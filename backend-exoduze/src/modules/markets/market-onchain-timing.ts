export type PublishedMarketTiming = {
  closesAt: string;
  decisionCutoffAt: string;
  joinDeadlineAt: string;
  opensAt: string;
  resolvesAt: string | null;
};

export function hasPublishedMarketTimingChange(
  existing: PublishedMarketTiming,
  next: PublishedMarketTiming,
) {
  return !(
    isSameInstant(existing.opensAt, next.opensAt) &&
    isSameInstant(existing.joinDeadlineAt, next.joinDeadlineAt) &&
    isSameInstant(existing.decisionCutoffAt, next.decisionCutoffAt) &&
    isSameInstant(existing.closesAt, next.closesAt) &&
    isSameNullableInstant(existing.resolvesAt, next.resolvesAt)
  );
}

function isSameInstant(left: string, right: string) {
  return Date.parse(left) === Date.parse(right);
}

function isSameNullableInstant(
  left: string | null,
  right: string | null,
) {
  if (left === null || right === null) {
    return left === right;
  }

  return isSameInstant(left, right);
}
