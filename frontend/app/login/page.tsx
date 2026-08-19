import { Suspense } from "react"
import { redirect } from "next/navigation"
import { MessageCircleIcon } from "lucide-react"

import { getCurrentUser } from "@/lib/current-user"
import { isConfigured } from "@/lib/auth"
import { LoginForm } from "@/components/auth/login-form"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default async function LoginPage() {
  // No flash of the dashboard: if already signed in, leave before rendering.
  const user = await getCurrentUser()
  if (user) redirect("/")

  const configured = isConfigured()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand text-brand-foreground">
            <MessageCircleIcon className="size-6" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              CreatED Automations
            </h1>
            <p className="text-sm text-muted-foreground">
              Group operations dashboard
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="sr-only">Sign in</CardHeader>
          <CardContent className="pt-6">
            <Suspense>
              <LoginForm />
            </Suspense>
          </CardContent>
        </Card>

        {configured ? null : (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <p className="font-medium">Not configured</p>
            <p className="mt-1 leading-relaxed">
              DATABASE_URL is not set, so credentials cannot be checked and no
              one can sign in.
            </p>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Invite-only. Contact an admin for access.
        </p>
      </div>
    </main>
  )
}
