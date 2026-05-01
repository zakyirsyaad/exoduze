import { DisputesAdminPage } from "@/components/admin/DisputesAdminPage"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Dispute Admin",
  description: "Review Exoduze market resolution disputes from the admin UI.",
  pathname: "/admin/disputes",
})

export default function AdminDisputesPage() {
  return <DisputesAdminPage />
}
