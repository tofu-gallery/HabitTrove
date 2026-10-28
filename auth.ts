// Modified by Tofu on 2026-10-28: accounts are checked by lib/accounts.ts, and
// the session secret is AUTH_SECRET or one derived from DATABASE_URL (see TOFU.md).
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { authenticate } from "./lib/accounts"
import { authSecret } from "./lib/tofu-database"
import { signInSchema } from "./lib/zod"
import { SessionUser } from "./lib/types"

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  // Tofu: read here, as the module loads, because Auth.js reads AUTH_SECRET at that moment too.
  secret: authSecret(),
  providers: [
    Credentials({
      credentials: {
        username: {},
        password: {},
      },
      authorize: async (credentials) => {
        const parsed = signInSchema.safeParse(credentials)
        if (!parsed.success) return null
        const { username, password } = parsed.data

        // Pass the plaintext password to authenticate for verification
        const user = await authenticate(username, password)

        // Tofu: null is Auth.js's own "wrong username or password" (CredentialsSignin).
        if (!user) return null

        const safeUser: SessionUser = { id: user.id }
        return safeUser
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = (user as SessionUser).id
      }
      return token
    },
    session: async ({ session, token }) => {
      if (session?.user) {
        session.user.id = token.id as string
      }
      return session
    }
  }
})
