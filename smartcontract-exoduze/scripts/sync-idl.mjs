import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourceIdl = resolve(
  rootDir,
  "target",
  "idl",
  "exoduze_prediction_market.json"
)
const destinations = [
  resolve(rootDir, "idl", "exoduze_prediction_market.json"),
  resolve(
    rootDir,
    "..",
    "backend-exoduze",
    "src",
    "modules",
    "onchain",
    "idl",
    "exoduze_prediction_market.json"
  ),
]

if (!existsSync(sourceIdl)) {
  throw new Error(
    `Generated IDL not found at ${sourceIdl}. Run 'anchor build' first.`
  )
}

for (const destination of destinations) {
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(sourceIdl, destination)
  console.log(`Copied ${sourceIdl} -> ${destination}`)
}

