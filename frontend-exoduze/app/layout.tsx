import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { NavbarResizable } from "@/components/NavbarResizable"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import {
  buildPageMetadata,
  defaultDescription,
  getSiteUrl,
  siteName,
} from "@/lib/seo"

import "@solana/wallet-adapter-react-ui/styles.css"
import "./wallet-adapter-overrides.css"
import Providers from "@/config/SolanaProvider"
import { AuthProvider } from "@/hooks/useAuth"
import type { Metadata } from "next"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  ...buildPageMetadata(),
  metadataBase: getSiteUrl(),
  applicationName: siteName,
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: defaultDescription,
  appleWebApp: {
    title: siteName,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          <Providers>
            <AuthProvider>
              <TooltipProvider>
                <NavbarResizable />
                {children}
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  )
}
