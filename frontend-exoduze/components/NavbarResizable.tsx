"use client"
import Link from "next/link"
import {
  Navbar,
  NavBody,
  NavItems,
  MobileNav,
  NavbarLogo,
  MobileNavHeader,
  MobileNavToggle,
  MobileNavMenu,
} from "@/components/ui/resizable-navbar"
import { useEffect, useState } from "react"
import { WalletConnectButton } from "./SolanaConnectButton"
import { useApi } from "@/hooks/useApi"
import { CategoriesResponse } from "@/hooks/Type"
import { useAuth } from "@/hooks/useAuth"

const defaultCategoryItems = [
  {
    name: "Trending",
    link: "/",
  },
  {
    name: "Politics",
    link: "/politics",
  },
  {
    name: "Esports",
    link: "/esports",
  },
  {
    name: "Finance",
    link: "/finance",
  },
  {
    name: "Tech",
    link: "/tech",
  },
  {
    name: "Crypto",
    link: "/crypto",
  },
  {
    name: "Sports",
    link: "/sports",
  },
  {
    name: "Economy",
    link: "/economy",
  },
  {
    name: "Science",
    link: "/science",
  },
]

export function NavbarResizable() {
  const auth = useAuth()
  const navItems = [
    {
      name: "Leaderboard",
      link: "/leaderbord",
    },
    {
      name: "Agents",
      link: "/agents",
    },
    {
      name: "Owners",
      link: "/owners",
    },
    {
      name: "Portfolio",
      link: "/portfolio",
    },
    {
      name: "Documentation",
      link: "#contact",
    },
  ]
  const primaryNavItems = auth.isAdmin
    ? [
      ...navItems.slice(0, 4),
      {
        name: "Admin",
        link: "/admin",
      },
      ...navItems.slice(4),
    ]
    : navItems

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const { data, loading, error, get } = useApi<CategoriesResponse>()

  useEffect(() => {
    void get("/v1/categories")
  }, [get])

  const categoryItems = data?.data?.length
    ? data.data.map((category) => ({
      name: category.name,
      link: `/${category.slug}`,
    }))
    : defaultCategoryItems

  return (
    <div className="relative w-full px-5 py-5 md:px-10 lg:px-20">
      <Navbar className="space-y-3">
        {/* Desktop Navigation */}
        <NavBody>
          <NavbarLogo />
          <NavItems items={primaryNavItems} />
          <div className="relative z-20 flex items-center">
            <WalletConnectButton />
          </div>
        </NavBody>

        {/* Mobile Navigation */}
        <MobileNav>
          <MobileNavHeader>
            <NavbarLogo />
            <MobileNavToggle
              isOpen={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            />
          </MobileNavHeader>

          <MobileNavMenu
            isOpen={isMobileMenuOpen}
            onClose={() => setIsMobileMenuOpen(false)}
          >
            {primaryNavItems.map((item, idx) => (
              <a
                key={`mobile-link-${idx}`}
                href={item.link}
                onClick={() => setIsMobileMenuOpen(false)}
                className="relative text-neutral-600 dark:text-neutral-300"
              >
                <span className="block">{item.name}</span>
              </a>
            ))}
            <div className="flex w-full flex-col gap-4">
              <WalletConnectButton />
            </div>
          </MobileNavMenu>
        </MobileNav>

        <section className="grid grid-cols-2 gap-2 rounded border px-3 py-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
          {categoryItems.map((item, idx) => (
            <Link
              key={`category-link-${item.name}-${idx}`}
              href={item.link}
              onClick={() => setIsMobileMenuOpen(false)}
              className="relative rounded px-3 py-1.5 text-sm text-neutral-600 duration-300 hover:bg-secondary dark:text-neutral-300"
            >
              <span className="block truncate text-center">{item.name}</span>
            </Link>
          ))}
        </section>
        {loading && !data?.data?.length ? (
          <p className="px-4 text-sm text-neutral-500">Loading categories...</p>
        ) : null}
        {error && !data?.data?.length ? (
          <p className="px-4 text-sm text-red-500">
            Failed to load categories: {error}
          </p>
        ) : null}
      </Navbar>
      {/* Navbar */}
    </div>
  )
}

// const DummyContent = () => {
//     return (
//         <div className="container mx-auto p-8 pt-24">
//             <h1 className="mb-4 text-center text-3xl font-bold">
//                 Check the navbar at the top of the container
//             </h1>
//             <p className="mb-10 text-center text-sm text-zinc-500">
//                 For demo purpose we have kept the position as{" "}
//                 <span className="font-medium">Sticky</span>. Keep in mind that this
//                 component is <span className="font-medium">fixed</span> and will not
//                 move when scrolling.
//             </p>
//             <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
//                 {[
//                     {
//                         id: 1,
//                         title: "The",
//                         width: "md:col-span-1",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 2,
//                         title: "First",
//                         width: "md:col-span-2",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 3,
//                         title: "Rule",
//                         width: "md:col-span-1",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 4,
//                         title: "Of",
//                         width: "md:col-span-3",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 5,
//                         title: "F",
//                         width: "md:col-span-1",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 6,
//                         title: "Club",
//                         width: "md:col-span-2",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 7,
//                         title: "Is",
//                         width: "md:col-span-2",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 8,
//                         title: "You",
//                         width: "md:col-span-1",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 9,
//                         title: "Do NOT TALK about",
//                         width: "md:col-span-2",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                     {
//                         id: 10,
//                         title: "F Club",
//                         width: "md:col-span-1",
//                         height: "h-60",
//                         bg: "bg-neutral-100 dark:bg-neutral-800",
//                     },
//                 ].map((box) => (
//                     <div
//                         key={box.id}
//                         className={`${box.width} ${box.height} ${box.bg} flex items-center justify-center rounded-lg p-4 shadow-sm`}
//                     >
//                         <h2 className="text-xl font-medium">{box.title}</h2>
//                     </div>
//                 ))}
//             </div>
//         </div>
//     );
// };
