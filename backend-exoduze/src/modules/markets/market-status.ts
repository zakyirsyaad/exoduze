const TERMINAL_MARKET_STATUSES = new Set(["draft", "disputed", "resolved", "cancelled"]);
const MANUAL_ACTIVE_STATUSES = new Set(["locked", "closed", "resolving"]);

type MarketStatusInput = {
  status: string;
  opens_at: string;
  closes_at: string;
  resolves_at?: string | null | undefined;
};

export function getEffectiveMarketStatus(input: MarketStatusInput, now = new Date()) {
  if (TERMINAL_MARKET_STATUSES.has(input.status)) {
    return input.status;
  }

  const nowMs = now.getTime();
  const opensAtMs = Date.parse(input.opens_at);
  const closesAtMs = Date.parse(input.closes_at);
  const resolvesAtMs = input.resolves_at ? Date.parse(input.resolves_at) : null;

  if (!Number.isNaN(opensAtMs) && opensAtMs > nowMs) {
    return MANUAL_ACTIVE_STATUSES.has(input.status) ? input.status : "upcoming";
  }

  if (!Number.isNaN(closesAtMs) && closesAtMs <= nowMs) {
    if (
      input.status === "resolving" ||
      (resolvesAtMs !== null && !Number.isNaN(resolvesAtMs) && resolvesAtMs <= nowMs)
    ) {
      return "resolving";
    }

    return "closed";
  }

  if (MANUAL_ACTIVE_STATUSES.has(input.status)) {
    return input.status;
  }

  return "open";
}

export function effectiveMarketStatusSql(alias = "m") {
  return `
    CASE
      WHEN ${alias}.id IS NULL THEN NULL
      WHEN ${alias}.status IN ('draft', 'disputed', 'resolved', 'cancelled') THEN ${alias}.status
      WHEN ${alias}.opens_at > now() THEN
        CASE
          WHEN ${alias}.status IN ('locked', 'closed', 'resolving') THEN ${alias}.status
          ELSE 'upcoming'
        END
      WHEN ${alias}.closes_at <= now() THEN
        CASE
          WHEN ${alias}.status = 'resolving'
            OR (${alias}.resolves_at IS NOT NULL AND ${alias}.resolves_at <= now())
          THEN 'resolving'
          ELSE 'closed'
        END
      WHEN ${alias}.status IN ('locked', 'closed', 'resolving') THEN ${alias}.status
      ELSE 'open'
    END
  `;
}
