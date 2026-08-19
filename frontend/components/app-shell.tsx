"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"

function useHeading(pathname: string) {
  if (pathname.startsWith("/mentors")) return "Mentor directory"
  if (pathname.startsWith("/groups")) return "Group detail"
  return "Groups"
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const heading = useHeading(pathname)

  // The login page owns its full-screen layout — no sidebar or header chrome.
  if (pathname === "/login") {
    return <>{children}</>
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-sm">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-4" />
          <Link href="/" className="text-sm font-medium hover:underline">
            CreatED Automations
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">{heading}</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
