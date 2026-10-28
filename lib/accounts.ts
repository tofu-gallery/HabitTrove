// Tofu: this file is Tofu's addition (2026-10-28), used by auth.ts and app/actions/data.ts (see TOFU.md).
import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { verifyPassword } from './server-helpers'
import { readDocument } from './store'
import type { User, UserData } from './types'

/** The hidden value the owner saves on Tofu: the password of the administrator account a new copy starts with. */
export const OWNER_PASSWORD_SETTING = 'HABITTROVE_ADMIN_PASSWORD'

export function ownerPassword(): string | undefined {
  const value = process.env[OWNER_PASSWORD_SETTING]
  return value && value.trim() ? value : undefined
}

/**
 * The administrator account a new copy starts with (`admin`, renamed or not)
 * has no password of its own: it signs in with HABITTROVE_ADMIN_PASSWORD, and
 * nobody can sign in to it while that is unset. Every other account has a
 * password of its own (upstream allowed accounts without one, which anyone who
 * opened the app could use; a copy on Tofu is on the public internet).
 */
export function usesOwnerPassword(user: Pick<User, 'isAdmin' | 'password'>): boolean {
  return !!user.isAdmin && !user.password
}

function sameText(a: string, b: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest()
  return timingSafeEqual(digest(a), digest(b))
}

export async function readUsers(): Promise<UserData> {
  return readDocument<UserData>('auth')
}

/** The account these credentials sign in to, or null. */
export async function authenticate(username: string, password: string | undefined): Promise<User | null> {
  if (!password) return null
  const { users } = await readUsers()
  const user = users.find((u) => u.username === username)
  if (!user) return null
  if (user.password) return verifyPassword(password, user.password) ? user : null
  if (usesOwnerPassword(user)) {
    const saved = ownerPassword()
    return saved && sameText(password, saved) ? user : null
  }
  return null
}
