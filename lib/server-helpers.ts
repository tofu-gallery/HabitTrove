// Modified by Tofu on 2026-10-28: accounts are read from PostgreSQL (lib/store.ts)
// instead of data/auth.json, and an account without a password no longer signs
// in with an empty one (see TOFU.md).
import { auth } from '@/auth'
import 'server-only'
import { User, UserData, UserId } from './types'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { readDocument } from './store'

async function loadUsersDataFromStore(): Promise<UserData> {
  return readDocument<UserData>('auth')
}

export async function getCurrentUserId(): Promise<UserId | undefined> {
  const session = await auth()
  const user = session?.user
  return user?.id
}

export async function getCurrentUser(): Promise<User | undefined> {
  const currentUserId = await getCurrentUserId()
  if (!currentUserId) {
    return undefined
  }
  const usersData = await loadUsersDataFromStore()
  return usersData.users.find((u) => u.id === currentUserId)
}
export function saltAndHashPassword(password: string, salt?: string): string {
  if (password.length === 0) throw new Error('Password must not be empty')
  salt = salt || randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password?: string, storedHash?: string): boolean {
  // Tofu: without a stored hash there is nothing to match, so no password signs in.
  if (!password || !storedHash) return false

  // Split the stored hash into its salt and hash components
  const [salt, hash] = storedHash.split(':')
  if (!salt || !hash) return false
  // Hash the input password with the same salt
  const newHash = saltAndHashPassword(password, salt).split(':')[1]
  // Compare the new hash with the stored hash
  const a = Buffer.from(newHash, 'hex')
  const b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
