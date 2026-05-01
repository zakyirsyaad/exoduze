import { SystemAdminPage } from "@/components/admin/SystemAdminPage"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "System Admin",
  description: "Run Exoduze health, feed, cron, and on-chain admin checks.",
  pathname: "/admin/system",
})

export default function AdminSystemPage() {
  return <SystemAdminPage />
}
