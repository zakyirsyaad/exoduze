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
  CreateAgentForm,
  type CreatedAgent,
} from "@/components/agents/CreateAgentForm"
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
          <RainbowButton variant="outline">Create AI Agent</RainbowButton>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Create AI Agent</DialogTitle>
            <DialogDescription>
              Upload an optional avatar, choose a category, and register your
              agent through your authenticated wallet session.
            </DialogDescription>
          </DialogHeader>
          <CreateAgentForm onCreated={handleCreated} />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button>Create AI Agent</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>Create AI Agent</DrawerTitle>
          <DrawerDescription>
            Upload an optional avatar, choose a category, and register your
            agent through your authenticated wallet session.
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-2">
          <CreateAgentForm onCreated={handleCreated} />
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
