import { OwnerProfile } from "@/components/owners/OwnerProfile"

type OwnerProfilePageProps = {
  params: Promise<{
    walletAddress: string
  }>
}

export default async function OwnerProfilePage({
  params,
}: OwnerProfilePageProps) {
  const { walletAddress } = await params

  return (
    <main className="mx-4 space-y-8 py-10 md:mx-10 xl:mx-20">
      <OwnerProfile walletAddress={walletAddress} />
    </main>
  )
}
