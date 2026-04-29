import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const assetCopies = [
  {
    from: resolve(projectRoot, "src/modules/onchain/idl"),
    to: resolve(projectRoot, "dist/modules/onchain/idl"),
  },
];

for (const asset of assetCopies) {
  if (!existsSync(asset.from)) {
    continue;
  }

  mkdirSync(dirname(asset.to), { recursive: true });
  cpSync(asset.from, asset.to, { recursive: true });
}
