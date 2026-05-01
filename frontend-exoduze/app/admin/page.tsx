import { AdminOverview } from "@/components/admin/AdminOverview"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Admin Overview",
  description: "Open Exoduze admin surfaces for catalog, market, dispute, and system operations.",
  pathname: "/admin",
})

export default function AdminPage() {
  return <AdminOverview />
}
