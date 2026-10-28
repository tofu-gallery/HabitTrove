// Modified by Tofu on 2026-10-28: avatars are kept in the database and are at
// most 3 MB, under the size a request to the app may carry (see TOFU.md).
export const ALLOWED_AVATAR_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
])

export const ALLOWED_AVATAR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

export const AVATAR_CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
}

export const MAX_AVATAR_BYTES = 3 * 1024 * 1024
