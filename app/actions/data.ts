'use server'

// Modified by Tofu on 2026-10-28 (see TOFU.md):
// - the data lives in PostgreSQL (lib/store.ts) instead of data/*.json, and
//   avatars in it instead of data/avatars;
// - every change runs with its documents locked from read to write, and a list
//   a device sends is merged item by item with the stored one (lib/tofu-merge.ts),
//   so two devices at once no longer undo each other;
// - every action checks who is asking: an exported function of this file is a
//   server action anyone can call, so internal helpers are no longer exported,
//   permissions are checked again here, and only an administrator manages
//   other accounts;
// - every account needs a password, and the administrator account a new copy
//   starts with signs in with HABITTROVE_ADMIN_PASSWORD (lib/accounts.ts);
// - no backups (Tofu runs nothing between requests; the database is backed up).

import fs from 'fs/promises'
import path from 'path'
import {
  HabitsData,
  CoinsData,
  CoinTransaction,
  TransactionType,
  WishlistItemType,
  WishlistData,
  Settings,
  DataType,
  getDefaultSettings,
  UserData,
  User,
  PublicUser,
  PublicUserData,
  getDefaultWishlistData,
  getDefaultHabitsData,
  getDefaultCoinsData,
  Habit,
  Permission,
  ServerSettings,
  DEFAULT_SOURCE_URL,
} from '@/lib/types'
import { checkPermission, d2t, getNow, uuid } from '@/lib/utils';
import { saltAndHashPassword } from "@/lib/server-helpers";
import { passwordSchema, usernameSchema } from '@/lib/zod';
import _ from 'lodash';
import { getCurrentUser } from '@/lib/server-helpers'
import { prepareDataForHashing, generateCryptoHash } from '@/lib/utils';
import { sanitizeUserData } from '@/lib/user-sanitizer'
import { ALLOWED_AVATAR_EXTENSIONS, ALLOWED_AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/lib/avatar'
import { PermissionError } from '@/lib/exceptions'
import { changeDocument, changeDocuments, readDocument, saveAvatar } from '@/lib/store'
import { mergeItems, ItemChange } from '@/lib/tofu-merge'
import { ownerPassword, readUsers, usesOwnerPassword, OWNER_PASSWORD_SETTING } from '@/lib/accounts'
import { MAX_COIN_LIMIT } from '@/lib/constants'



type ResourceType = 'habit' | 'wishlist' | 'coins'
type ActionType = 'write' | 'interact'

/** The account asking, or an error when nobody is signed in. */
async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) throw new PermissionError('User not authenticated')
  return user
}

function hasPermission(user: User, resource: ResourceType, action: ActionType): boolean {
  return !!user.isAdmin || checkPermission(user.permissions, resource, action)
}

async function verifyPermission(
  resource: ResourceType,
  action: ActionType
): Promise<User> {
  const user = await requireUser()
  if (!hasPermission(user, resource, action)) {
    throw new PermissionError(`User does not have ${action} permission for ${resource}`)
  }
  return user
}

async function requireAdmin(): Promise<User> {
  const user = await requireUser()
  if (!user.isAdmin) throw new PermissionError('Only an administrator can do this')
  return user
}

const visibleTo = (user: User) => (item: { userIds?: string[] }) =>
  !!user.isAdmin || !!item.userIds?.includes(user.id)

/**
 * Applies a device's change to a stored list of habits or wishes: only what it
 * changed, item by item (lib/tofu-merge.ts), and only what this account may
 * change. A change that touches nothing but `interactFields` (checking off a
 * habit, redeeming a wish) needs the "interact" permission; anything else
 * needs "write".
 */
function applyListChange<T extends { id: string; userIds?: string[] }>(
  user: User,
  resource: 'habit' | 'wishlist',
  current: T[],
  base: T[] | undefined,
  next: T[],
  interactFields: { required: string; allowed: string[] },
): T[] {
  const visible = current.filter(visibleTo(user))
  // Without the list the device started from, its list replaces what this account can see, as upstream did.
  const startedFrom = Array.isArray(base) ? base.filter(visibleTo(user)) : visible
  const sent = next.map(item => {
    const userIds = item.userIds?.length ? item.userIds : [user.id]
    // Someone who is not an administrator keeps every item they make or change their own.
    return { ...item, userIds: user.isAdmin || userIds.includes(user.id) ? userIds : [...userIds, user.id] }
  })
  const { items, changes } = mergeItems(current, startedFrom, sent)
  for (const change of changes as ItemChange<T>[]) {
    if (change.kind !== 'added' && !visibleTo(user)(change.before)) {
      throw new PermissionError(`User cannot change this ${resource}`)
    }
    const onlyInteraction = change.kind === 'changed'
      && change.fields.includes(interactFields.required)
      && change.fields.every(field => interactFields.allowed.includes(field))
    if (!hasPermission(user, resource, onlyInteraction ? 'interact' : 'write')) {
      throw new PermissionError(`User does not have ${onlyInteraction ? 'interact' : 'write'} permission for ${resource}`)
    }
  }
  return items
}

async function loadData<T>(type: DataType): Promise<T> {
  return readDocument<T>(type)
}

/**
 * Calculates the server's global freshness token based on all core data files.
 * This is an expensive operation as it reads all data files.
 */
async function calculateServerFreshnessToken(): Promise<string | null> {
  try {
    const settings = await loadSettings();
    const habits = await loadHabitsData();
    const coins = await loadCoinsData();
    const wishlist = await loadWishlistData();
    const users = await loadUsersPublicData();

    const dataString = prepareDataForHashing(
      settings,
      habits,
      coins,
      wishlist,
      users
    );
    const serverToken = await generateCryptoHash(dataString);
    return serverToken;
  } catch (error) {
    console.error("Error calculating server freshness token:", error);
    throw error;
  }
}

// Wishlist specific functions
export async function loadWishlistData(): Promise<WishlistData> {
  const user = await getCurrentUser()
  if (!user) return getDefaultWishlistData()

  const data = await loadData<WishlistData>('wishlist')
  return {
    ...data,
    items: data.items.filter(x => user.isAdmin || x.userIds?.includes(user.id))
  }
}

export async function loadWishlistItems(): Promise<WishlistItemType[]> {
  const data = await loadWishlistData()
  return data.items
}

/** `base` is the list the device started from (Tofu: see applyListChange). */
export async function saveWishlistItems(data: WishlistData, base?: WishlistData): Promise<void> {
  const user = await requireUser()
  if (!Array.isArray(data?.items)) throw new Error('Invalid wishlist')
  await changeDocument<WishlistData, void>('wishlist', (current) => ({
    doc: {
      ...current,
      items: applyListChange(user, 'wishlist', current.items, base?.items, data.items,
        { required: 'targetCompletions', allowed: ['targetCompletions', 'archived'] }),
    },
    result: undefined,
  }))
}

// Habits specific functions
export async function loadHabitsData(): Promise<HabitsData> {
  const user = await getCurrentUser()
  if (!user) return getDefaultHabitsData()
  const data = await loadData<HabitsData>('habits')
  return {
    ...data,
    habits: data.habits.filter(x => user.isAdmin || x.userIds?.includes(user.id))
  }
}

/** `base` is the list the device started from (Tofu: see applyListChange). */
export async function saveHabitsData(data: HabitsData, base?: HabitsData): Promise<void> {
  const user = await requireUser()
  if (!Array.isArray(data?.habits)) throw new Error('Invalid habits')
  await changeDocument<HabitsData, void>('habits', (current) => ({
    doc: {
      ...current,
      habits: applyListChange<Habit>(user, 'habit', current.habits, base?.habits, data.habits,
        { required: 'completions', allowed: ['completions', 'archived'] }),
    },
    result: undefined,
  }))
}


// Coins specific functions
export async function loadCoinsData(): Promise<CoinsData> {
  try {
    const user = await getCurrentUser()
    if (!user) return getDefaultCoinsData()
    const data = await loadData<CoinsData>('coins')
    return {
      ...data,
      transactions: user.isAdmin ? data.transactions : data.transactions.filter(x => x.userId === user.id)
    }
  } catch {
    return getDefaultCoinsData()
  }
}

/** Which permission a kind of coin transaction needs. */
function permissionFor(type: TransactionType): [ResourceType, ActionType] {
  switch (type) {
    case 'MANUAL_ADJUSTMENT': return ['coins', 'write']
    case 'WISH_REDEMPTION': return ['wishlist', 'interact']
    default: return ['habit', 'interact']
  }
}

const TRANSACTION_TYPES: TransactionType[] = ['HABIT_COMPLETION', 'HABIT_UNDO', 'WISH_REDEMPTION', 'MANUAL_ADJUSTMENT', 'TASK_COMPLETION', 'TASK_UNDO']

async function recordTransaction(
  sign: 1 | -1,
  { amount, description, type = 'MANUAL_ADJUSTMENT', relatedItemId, note, userId }: {
    amount: number
    description: string
    type?: TransactionType
    relatedItemId?: string
    note?: string
    userId?: string
  },
): Promise<CoinsData> {
  if (!TRANSACTION_TYPES.includes(type)) throw new Error('Invalid transaction type')
  const [resource, action] = permissionFor(type)
  const currentUser = await verifyPermission(resource, action)
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_COIN_LIMIT) {
    throw new Error('Invalid amount')
  }
  if (userId && userId !== currentUser.id && !currentUser.isAdmin) {
    throw new PermissionError('Only an administrator can change another account\'s coins')
  }
  return changeDocument<CoinsData, CoinsData>('coins', (data) => {
    const newTransaction: CoinTransaction = {
      id: uuid(),
      amount: sign * amount,
      type,
      description: String(description ?? '').slice(0, 500),
      timestamp: d2t({ dateTime: getNow({}) }),
      ...(relatedItemId && { relatedItemId: String(relatedItemId) }),
      ...(note && note.trim() !== '' && { note: String(note).slice(0, 2000) }),
      userId: userId || currentUser.id
    }
    const doc: CoinsData = {
      balance: sign > 0 ? data.balance + amount : Math.max(0, data.balance - amount),
      transactions: [newTransaction, ...data.transactions]
    }
    return {
      doc,
      result: {
        ...doc,
        transactions: currentUser.isAdmin ? doc.transactions : doc.transactions.filter(x => x.userId === currentUser.id)
      },
    }
  })
}

export async function addCoins(input: {
  amount: number
  description: string
  type?: TransactionType
  relatedItemId?: string
  note?: string
  userId?: string
}): Promise<CoinsData> {
  return recordTransaction(1, input)
}

/** Tofu: replaces upstream's saveCoinsData, which wrote a whole ledger sent by the browser; a note is all it changed. */
export async function updateTransactionNote(transactionId: string, note: string): Promise<CoinsData> {
  const user = await verifyPermission('coins', 'write')
  return changeDocument<CoinsData, CoinsData>('coins', (data) => {
    const transaction = data.transactions.find(t => t.id === transactionId)
    if (!transaction || (!user.isAdmin && transaction.userId !== user.id)) {
      throw new Error('Transaction not found')
    }
    const trimmed = String(note ?? '').trim().slice(0, 2000)
    const doc: CoinsData = {
      ...data,
      transactions: data.transactions.map(t => {
        if (t.id !== transactionId) return t
        const updated = { ...t }
        if (trimmed) updated.note = trimmed
        else delete updated.note
        return updated
      })
    }
    return {
      doc,
      result: { ...doc, transactions: user.isAdmin ? doc.transactions : doc.transactions.filter(x => x.userId === user.id) },
    }
  })
}

export async function loadSettings(): Promise<Settings> {
  const defaultSettings = getDefaultSettings()

  try {
    const user = await getCurrentUser()
    if (!user) return defaultSettings
    const data = await loadData<Settings>('settings')
    return { ...defaultSettings, ...data }
  } catch {
    return defaultSettings
  }
}

// The languages messages/ holds: i18n/request.ts loads messages/<language>.json for every page.
const LANGUAGES = ['en', 'es', 'ca', 'de', 'fr', 'ru', 'zh', 'ko', 'ja']

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await requireUser()
  const defaults = getDefaultSettings()
  const clean: Settings = {
    ui: {
      useNumberFormatting: settings?.ui?.useNumberFormatting ?? defaults.ui.useNumberFormatting,
      useGrouping: settings?.ui?.useGrouping ?? defaults.ui.useGrouping,
    },
    system: {
      timezone: isTimeZone(settings?.system?.timezone) ? settings.system.timezone : defaults.system.timezone,
      weekStartDay: Number.isInteger(settings?.system?.weekStartDay) && settings.system.weekStartDay >= 0 && settings.system.weekStartDay <= 6
        ? settings.system.weekStartDay : defaults.system.weekStartDay,
      language: LANGUAGES.includes(settings?.system?.language) ? settings.system.language : defaults.system.language,
    },
    profile: {},
  }
  await changeDocument<Settings, void>('settings', () => ({ doc: clean, result: undefined }))
}

export async function removeCoins(input: {
  amount: number
  description: string
  type?: TransactionType
  relatedItemId?: string
  note?: string
  userId?: string
}): Promise<CoinsData> {
  return recordTransaction(-1, input)
}

export async function uploadAvatar(formData: FormData): Promise<string> {
  const user = await requireUser()
  const file = formData.get('avatar') as File
  if (!file || typeof file === 'string') throw new Error('No file provided')

  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('File size is over the limit')
  }

  const mimeType = file.type.toLowerCase()
  if (!ALLOWED_AVATAR_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported avatar MIME type')
  }

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported avatar file extension')
  }

  // Generate unique filename
  const filename = `${Date.now()}-${uuid()}${ext}`

  // Tofu: saved in the database (lib/store.ts); /api/avatars/<filename> serves it.
  const buffer = await file.arrayBuffer()
  await saveAvatar(filename, mimeType, Buffer.from(buffer), user.id)

  return `/data/avatars/${filename}`
}

export async function getChangelog(): Promise<string> {
  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md')
    return await fs.readFile(changelogPath, 'utf8')
  } catch (error) {
    console.error('Error loading changelog:', error)
    return '# Changelog\n\nNo changelog available.'
  }
}

// user logic
async function loadUsersData(): Promise<UserData> {
  return readUsers()
}

export async function loadUsersPublicData(): Promise<PublicUserData> {
  const data = await loadUsersData()
  return sanitizeUserData(data, !!ownerPassword())
}

function parsePermissions(raw: unknown): Permission[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) return undefined
  const flag = (value: unknown) => value === true
  return parsed.map((p: Partial<Permission>) => ({
    habit: { write: flag(p?.habit?.write), interact: flag(p?.habit?.interact) },
    wishlist: { write: flag(p?.wishlist?.write), interact: flag(p?.wishlist?.interact) },
    coins: { write: flag(p?.coins?.write), interact: flag(p?.coins?.interact) },
  }))
}

// The paths uploadAvatar answers with: /data/avatars/<milliseconds>-<uuid><extension>.
const AVATAR_PATH = /^\/data\/avatars\/[A-Za-z0-9-]+\.[a-z]+$/

/** A password every account must have: 4 to 128 characters (Tofu: never empty). */
function checkedPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Every account needs a password')
  }
  passwordSchema.parse(password)
  return password
}

export async function createUser(formData: FormData): Promise<PublicUser> {
  await requireAdmin()
  const username = formData.get('username') as string;
  const password = checkedPassword(formData.get('password'));
  const avatarPath = formData.get('avatarPath') as string;
  const permissions = parsePermissions(formData.get('permissions'));

  // Validate username against schema
  usernameSchema.parse(username);
  if (avatarPath && !AVATAR_PATH.test(avatarPath)) throw new Error('Invalid avatar');

  const hashedPassword = saltAndHashPassword(password);

  return changeDocument<UserData, PublicUser>('auth', (data) => {
    // Check if username already exists
    if (data.users.some(user => user.username === username)) {
      throw new Error('Username already exists');
    }

    const newUser: User = {
      id: uuid(),
      username,
      password: hashedPassword,
      permissions,
      isAdmin: false,
      lastNotificationReadTimestamp: undefined,
      ...(typeof avatarPath === 'string' && avatarPath && { avatarPath })
    };

    return {
      doc: { users: [...data.users, newUser] },
      result: sanitizeUserData({ users: [newUser] }, !!ownerPassword()).users[0],
    }
  })
}

export async function updateUser(userId: string, updates: Partial<Omit<User, 'id' | 'password'>>): Promise<PublicUser> {
  const caller = await requireUser()
  if (!caller.isAdmin && caller.id !== userId) {
    throw new PermissionError('Only an administrator can change another account')
  }
  // Tofu: only these fields can be changed here, and only an administrator changes the last two.
  const allowed: Partial<User> = {}
  if (updates?.username !== undefined) allowed.username = usernameSchema.parse(updates.username)
  if (updates?.avatarPath !== undefined) {
    if (updates.avatarPath && !AVATAR_PATH.test(updates.avatarPath)) {
      throw new Error('Invalid avatar')
    }
    allowed.avatarPath = updates.avatarPath || undefined
  }
  if (caller.isAdmin) {
    if (updates?.permissions !== undefined) allowed.permissions = parsePermissions(JSON.stringify(updates.permissions))
    if (updates?.isAdmin !== undefined) allowed.isAdmin = updates.isAdmin === true
  }

  return changeDocument<UserData, PublicUser>('auth', (data) => {
    const userIndex = data.users.findIndex(user => user.id === userId)

    if (userIndex === -1) {
      throw new Error('User not found')
    }

    // If username is being updated, check for duplicates
    if (allowed.username) {
      const isDuplicate = data.users.some(
        user => user.username === allowed.username && user.id !== userId
      )
      if (isDuplicate) {
        throw new Error('Username already exists')
      }
    }

    const existing = data.users[userIndex]
    if (allowed.isAdmin === false && usesOwnerPassword(existing)) {
      throw new Error(`This account signs in with ${OWNER_PASSWORD_SETTING} and stays an administrator`)
    }

    const updatedUser = {
      ...existing,
      ...allowed
    }

    return {
      doc: {
        users: [
          ...data.users.slice(0, userIndex),
          updatedUser,
          ...data.users.slice(userIndex + 1)
        ]
      },
      result: sanitizeUserData({ users: [updatedUser] }, !!ownerPassword()).users[0],
    }
  })
}

export async function updateUserPassword(userId: string, newPassword?: string): Promise<void> {
  const caller = await requireUser()
  if (!caller.isAdmin && caller.id !== userId) {
    throw new PermissionError('Only an administrator can change another account\'s password')
  }
  // Tofu: no account can be left without a password.
  const hashedPassword = saltAndHashPassword(checkedPassword(newPassword))

  await changeDocument<UserData, void>('auth', (data) => {
    const userIndex = data.users.findIndex(user => user.id === userId)

    if (userIndex === -1) {
      throw new Error('User not found')
    }
    if (usesOwnerPassword(data.users[userIndex])) {
      throw new Error(`This account's password is the ${OWNER_PASSWORD_SETTING} saved on Tofu: change it there`)
    }

    const updatedUser = {
      ...data.users[userIndex],
      password: hashedPassword
    }

    return {
      doc: {
        users: [
          ...data.users.slice(0, userIndex),
          updatedUser,
          ...data.users.slice(userIndex + 1)
        ]
      },
      result: undefined,
    }
  })
}

export async function deleteUser(userId: string): Promise<void> {
  const caller = await requireUser()
  if (!caller.isAdmin && caller.id !== userId) {
    throw new PermissionError('Only an administrator can delete another account')
  }

  await changeDocuments<void>(['wishlist', 'habits', 'coins', 'auth'], (docs) => {
    const wishlistData = docs.wishlist as WishlistData
    const habitsData = docs.habits as HabitsData
    const coinsData = docs.coins as CoinsData
    const authData = docs.auth as UserData

    // Delete User from Auth Data
    const userIndex = authData.users.findIndex(user => user.id === userId)

    if (userIndex === -1) {
      throw new Error('User not found')
    }
    const target = authData.users[userIndex]
    if (usesOwnerPassword(target)) {
      throw new Error(`The account that signs in with ${OWNER_PASSWORD_SETTING} cannot be deleted`)
    }
    if (target.isAdmin && authData.users.filter(u => u.isAdmin).length <= 1) {
      throw new Error('The last administrator cannot be deleted')
    }

    // Process Wishlist Data
    const updatedWishlistItems = wishlistData.items.reduce((acc, item) => {
      if (item.userIds?.includes(userId)) {
        if (item.userIds.length === 1) {
          // Remove item if this is the only user
          return acc
        } else {
          // Remove userId from item's userIds
          acc.push({
            ...item,
            userIds: item.userIds.filter(id => id !== userId)
          })
        }
      } else {
        // Keep item as is
        acc.push(item)
      }
      return acc
    }, [] as WishlistItemType[])

    // Process Habits Data
    const updatedHabits = habitsData.habits.reduce((acc, habit) => {
      if (habit.userIds?.includes(userId)) {
        if (habit.userIds.length === 1) {
          // Remove habit if this is the only user
          return acc
        } else {
          // Remove userId from habit's userIds
          acc.push({
            ...habit,
            userIds: habit.userIds.filter(id => id !== userId)
          })
        }
      } else {
        // Keep habit as is
        acc.push(habit)
      }
      return acc
    }, [] as HabitsData['habits'])

    // Process Coins Data
    const transactions = coinsData.transactions.filter(
      transaction => transaction.userId !== userId
    )

    return {
      write: {
        wishlist: { ...wishlistData, items: updatedWishlistItems },
        habits: { ...habitsData, habits: updatedHabits },
        coins: {
          ...coinsData,
          transactions,
          // Recalculate balance
          balance: transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
        },
        auth: {
          users: [
            ...authData.users.slice(0, userIndex),
            ...authData.users.slice(userIndex + 1)
          ]
        },
      },
      result: undefined,
    }
  })
}

export async function updateLastNotificationReadTimestamp(userId: string, timestamp: string): Promise<void> {
  const caller = await requireUser()
  if (caller.id !== userId) throw new PermissionError('An account only marks its own notifications read')
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) throw new Error('Invalid timestamp')

  await changeDocument<UserData, void>('auth', (data) => {
    const userIndex = data.users.findIndex(user => user.id === userId)

    if (userIndex === -1) {
      throw new Error('User not found for updating notification timestamp')
    }

    const updatedUser = {
      ...data.users[userIndex],
      lastNotificationReadTimestamp: timestamp
    }

    return {
      doc: {
        users: [
          ...data.users.slice(0, userIndex),
          updatedUser,
          ...data.users.slice(userIndex + 1)
        ]
      },
      result: undefined,
    }
  })
}


export async function loadServerSettings(): Promise<ServerSettings> {
  const sourceUrl = process.env.SOURCE_URL?.trim()
  return {
    isDemo: !!process.env.DEMO,
    adminPasswordMissing: !ownerPassword(),
    sourceUrl: sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl : DEFAULT_SOURCE_URL,
  }
}

/**
 * Checks if the client's data is fresh by comparing its token with the server's token.
 * @param clientToken The freshness token calculated by the client.
 * @returns A promise that resolves to an object { isFresh: boolean }.
 */
export async function checkDataFreshness(clientToken: string): Promise<{ isFresh: boolean }> {
  try {
    const serverToken = await calculateServerFreshnessToken();
    const isFresh = clientToken === serverToken;
    if (!isFresh) {
      console.log(`Data freshness check: Stale. Client token: ${clientToken}, Server token: ${serverToken}`);
    }
    return { isFresh };
  } catch (error) {
    console.error("Error in checkDataFreshness:", error);
    // If server fails to determine its token, assume client might be stale to be safe,
    // or handle error reporting differently.
    return { isFresh: false };
  }
}
