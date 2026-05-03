import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "slqazncyfyhijkybkwbk.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
}

export default nextConfig
