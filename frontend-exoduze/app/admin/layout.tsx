import type { ReactNode } from "react"

import { AdminShell } from "@/components/admin/AdminShell"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Admin",
  description:
    "Admin-only Exoduze tools for catalog, market, dispute, and system operations.",
  pathname: "/admin",
})

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
