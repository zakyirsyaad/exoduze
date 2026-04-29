import { resolve4, resolve6 } from "node:dns/promises";

type SystemError = Error & {
  code?: string;
  hostname?: string;
};

const DNS_OR_NETWORK_ERROR_CODES = new Set(["EAI_AGAIN", "ENETUNREACH", "ENOTFOUND"]);

export async function explainDatabaseConnectionError(error: unknown, databaseUrl: string) {
  if (!isSystemError(error) || !error.code || !DNS_OR_NETWORK_ERROR_CODES.has(error.code)) {
    return null;
  }

  const host = getDatabaseHost(databaseUrl) ?? error.hostname;
  if (!host) {
    return null;
  }

  const lines = [`Database connection failed (${error.code}) for host "${host}".`];

  if (isSupabaseDirectDatabaseHost(host)) {
    const records = await resolveIpRecords(host);

    if (!records.hasIpv4 && records.hasIpv6) {
      lines.push(
        "This Supabase direct database host resolves only to IPv6 from this network.",
        "If your local machine, ISP, VPN, or runtime cannot reach IPv6, replace DATABASE_URL with the Supabase Session pooler connection string from Dashboard > Connect."
      );
    } else {
      lines.push(
        "Check that the Supabase project is active, the DATABASE_URL project ref is correct, and your network can reach Supabase Postgres."
      );
    }
  }

  lines.push(`Original error: ${error.message}`);
  return lines.join("\n");
}

function isSystemError(error: unknown): error is SystemError {
  return error instanceof Error;
}

function getDatabaseHost(databaseUrl: string) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}

function isSupabaseDirectDatabaseHost(host: string) {
  return host.startsWith("db.") && host.endsWith(".supabase.co");
}

async function resolveIpRecords(host: string) {
  const [ipv4Result, ipv6Result] = await Promise.allSettled([resolve4(host), resolve6(host)]);

  return {
    hasIpv4: ipv4Result.status === "fulfilled" && ipv4Result.value.length > 0,
    hasIpv6: ipv6Result.status === "fulfilled" && ipv6Result.value.length > 0
  };
}
