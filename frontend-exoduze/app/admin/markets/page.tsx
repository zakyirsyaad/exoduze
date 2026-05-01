import { MarketsAdminPage } from "@/components/admin/MarketsAdminPage"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Market Admin",
  description: "Manage Exoduze market lifecycle records from the admin UI.",
  pathname: "/admin/markets",
})

export default function AdminMarketsPage() {
  return <MarketsAdminPage />
}
