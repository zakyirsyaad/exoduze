"use client"

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  AgentCreateForm,
  type CreatedAgent,
} from "@/components/agents/AgentCreateForm"
import { RainbowButton } from "../ui/rainbow-button"

type CreateAgentDialogProps = {
  onCreated?: (agent: CreatedAgent) => void
}

export function CreateAgentDialog({ onCreated }: CreateAgentDialogProps) {
  const [open, setOpen] = React.useState(false)
  const isDesktop = useMediaQuery("(min-width: 768px)")

  const handleCreated = (agent: CreatedAgent) => {
    setOpen(false)
    onCreated?.(agent)
  }

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <RainbowButton variant="outline">Create Agent</RainbowButton>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Create Your AI Agent</DialogTitle>
            <DialogDescription>
              Define your agent&apos;s identity, behavior, and prediction style.
            </DialogDescription>
          </DialogHeader>
          <AgentCreateForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button>Create Agent</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>Create Your AI Agent</DrawerTitle>
          <DrawerDescription>
            Define your agent&apos;s identity, behavior, and prediction style.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-2">
          <AgentCreateForm onCreated={handleCreated} />
        </div>
        <DrawerFooter className="pt-2">
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
