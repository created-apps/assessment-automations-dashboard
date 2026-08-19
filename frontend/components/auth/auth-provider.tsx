"use client"

import * as React from "react"

import type { SessionUser } from "@/lib/types"

const AuthContext = React.createContext<SessionUser | null>(null)

/**
 * Makes the current session user available to client components. The user is
 * resolved server-side (from the httpOnly cookie) in the root layout and passed
 * down, so nothing sensitive is fetched on the client.
 */
export function AuthProvider({
  user,
  children,
}: {
  user: SessionUser | null
  children: React.ReactNode
}) {
  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>
}

/** The current user, or `null` on public routes like /login. */
export function useAuth(): SessionUser | null {
  return React.useContext(AuthContext)
}

/** Convenience: whether the current user may trigger message-sending actions. */
export function useCanSendActions(): boolean {
  const user = React.useContext(AuthContext)
  return user?.role === "admin"
}
