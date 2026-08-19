"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, UsersRoundIcon, MessageCircleIcon } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { UserMenu } from "@/components/auth/user-menu"
import { useAuth } from "@/components/auth/auth-provider"

const NAV = [
  { title: "Groups", href: "/", icon: LayoutGridIcon },
  { title: "Mentors", href: "/mentors", icon: UsersRoundIcon },
]

export function AppSidebar() {
  const pathname = usePathname()
  const user = useAuth()

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <MessageCircleIcon className="size-4.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">CreatED</span>
            <span className="text-xs text-muted-foreground">Automations</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/groups")
                    : pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        {user ? (
          <UserMenu user={user} />
        ) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Not signed in
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
