// Modified by Tofu on 2026-10-28: avatars are read from the database
// (lib/store.ts) instead of data/avatars (see TOFU.md).
import { NextResponse } from 'next/server'
import path from 'path'
import { ALLOWED_AVATAR_EXTENSIONS, AVATAR_CONTENT_TYPE } from '@/lib/avatar'
import { readAvatar } from '@/lib/store'

// The names uploadAvatar gives: `<milliseconds>-<uuid><extension>`.
const AVATAR_NAME = /^[A-Za-z0-9-]+\.[a-z]+$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await Promise.resolve(params)

  if (!pathSegments || pathSegments.length !== 1) {
    return NextResponse.json({ error: 'Invalid avatar path' }, { status: 400 })
  }

  let name: string
  try {
    name = decodeURIComponent(pathSegments[0])
  } catch {
    return NextResponse.json({ error: 'Invalid avatar path' }, { status: 400 })
  }

  if (!AVATAR_NAME.test(name)) {
    return NextResponse.json({ error: 'Invalid avatar path' }, { status: 400 })
  }

  const ext = path.extname(name).toLowerCase()

  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  try {
    const avatar = await readAvatar(name)
    if (!avatar) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      )
    }

    return new NextResponse(new Uint8Array(avatar.bytes), {
      headers: {
        'Content-Type': AVATAR_CONTENT_TYPE[ext] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error reading avatar:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
