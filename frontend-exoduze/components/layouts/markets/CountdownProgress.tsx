"use client"

import { useEffect, useState } from "react"

type CountdownProgressProps = {
  initialTime?: string
}

const parseTimeToSeconds = (time?: string) => {
  if (!time) {
    return 0
  }

  const timeParts = time.split(":").map((part) => Number(part))

  if (timeParts.some((part) => Number.isNaN(part))) {
    return 0
  }

  if (timeParts.length === 3) {
    const [hours, minutes, seconds] = timeParts
    return hours * 3600 + minutes * 60 + seconds
  }

  if (timeParts.length === 2) {
    const [minutes, seconds] = timeParts
    return minutes * 60 + seconds
  }

  return 0
}

const formatSeconds = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

export default function CountdownProgress({
  initialTime,
}: CountdownProgressProps) {
  const initialSeconds = parseTimeToSeconds(initialTime)
  const [remainingSeconds, setRemainingSeconds] = useState(() => initialSeconds)

  useEffect(() => {
    if (initialSeconds <= 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((currentSeconds) =>
        currentSeconds <= 1 ? 0 : currentSeconds - 1
      )
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [initialSeconds])

  return (
    <div className="mt-2">
      <p className="text-xl font-semibold tabular-nums">
        {remainingSeconds > 0 ? formatSeconds(remainingSeconds) : "Ended"}
      </p>
    </div>
  )
}
