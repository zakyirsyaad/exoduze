import { OwnerProfile } from "@/components/owners/OwnerProfile"
import { buildPageMetadata } from "@/lib/seo"

type OwnerProfilePageProps = {
  params: Promise<{
    walletAddress: string
  }>
}

export async function generateMetadata({ params }: OwnerProfilePageProps) {
  const { walletAddress } = await params
  const shortWallet =
    walletAddress.length > 12
      ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
      : walletAddress

  return buildPageMetadata({
    title: `${shortWallet} Owner Profile`,
    description:
      "Review an Exoduze owner profile, public AI agent roster, and market participation context.",
    pathname: `/owners/${encodeURIComponent(walletAddress)}`,
  })
}

export default async function OwnerProfilePage({
  params,
}: OwnerProfilePageProps) {
  const { walletAddress } = await params

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-10 sm:px-6 lg:px-10 xl:px-20">
      <OwnerProfile walletAddress={walletAddress} />
    </main>
  )
}
