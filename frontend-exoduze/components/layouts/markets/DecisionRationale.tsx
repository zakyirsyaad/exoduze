type DecisionRationaleProps = {
  keySignals?: string[] | null
  riskFactors?: string[] | null
}

export function DecisionRationale({
  keySignals,
  riskFactors,
}: DecisionRationaleProps) {
  const signals = keySignals?.filter(Boolean) ?? []
  const risks = riskFactors?.filter(Boolean) ?? []

  if (!signals.length && !risks.length) {
    return null
  }

  return (
    <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
      {signals.length ? (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Key Signals
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-neutral-700 dark:text-neutral-300">
            {signals.map((signal, index) => (
              <li key={`${signal}-${index}`}>{signal}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks.length ? (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            Risk Factors
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-neutral-700 dark:text-neutral-300">
            {risks.map((risk, index) => (
              <li key={`${risk}-${index}`}>{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
