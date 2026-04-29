import AllMarket from "@/components/layouts/home/AllMarket"
import { Ecosystem } from "@/components/layouts/home/Ecosystem"
import Hero from "@/components/layouts/home/Hero"

// import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="mx-20 space-y-10">
      {/* <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Project ready!</h1>
          <p>You may now add components and start building.</p>
          <p>We&apos;ve already added the button component for you.</p>
          <Button className="mt-2">Button</Button>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          (Press <kbd>d</kbd> to toggle dark mode)
        </div>
      </div> */}
      <Hero />
      <Ecosystem />
      <AllMarket />
    </div>
  )
}
