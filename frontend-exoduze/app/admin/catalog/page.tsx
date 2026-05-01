import { CatalogAdminPage } from "@/components/admin/CatalogAdminPage"
import { buildPageMetadata } from "@/lib/seo"

export const metadata = buildPageMetadata({
  title: "Catalog Admin",
  description: "Manage Exoduze category and topic records from the admin UI.",
  pathname: "/admin/catalog",
})

export default function AdminCatalogPage() {
  return <CatalogAdminPage />
}
