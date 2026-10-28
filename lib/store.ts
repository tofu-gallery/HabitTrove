// Tofu: this file is Tofu's addition (2026-10-28). Upstream keeps each kind of
// data as one JSON file in data/ (settings, habits, coins, wishlist, auth) and
// avatars as files in data/avatars. Tofu's hosting has no lasting disk, so the
// same documents live in PostgreSQL: one row per document in
// habittrove_documents, and one row per avatar in habittrove_avatars (see TOFU.md).
import type { PoolClient } from 'pg'
import { DATA_DEFAULTS, type DataType } from './types'
import { getPool } from './tofu-database'

const DOCUMENTS = 'habittrove_documents'
const AVATARS = 'habittrove_avatars'

// Any constant shared by every start of this app: the key of the one advisory
// lock the schema step runs under.
const SCHEMA_LOCK_KEY = 72120261028

let schemaReady: Promise<void> | undefined

/**
 * Makes the app's two tables once. Tofu starts a new deployment's app several
 * times at once against the same new, empty database, so the work runs in one
 * transaction under one transaction-level advisory lock (the transaction
 * pooler gives a session to someone else between transactions, so a
 * session-level lock is never used): one start makes the tables, the others
 * wait for the lock and then find them made. Row-level security is turned on
 * for both tables, with no policy, where the database has Supabase's Data API
 * roles, so the public API key cannot read or change them; the app's own
 * connection owns the tables and is not limited by it.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = makeSchema().catch((error) => {
      schemaReady = undefined
      throw error
    })
  }
  return schemaReady
}

async function makeSchema(): Promise<void> {
  const pool = getPool()
  const found = await pool.query<{ ready: boolean }>(
    `SELECT to_regclass('public.${DOCUMENTS}') IS NOT NULL
        AND to_regclass('public.${AVATARS}') IS NOT NULL AS ready`,
  )
  if (found.rows[0]?.ready) {
    console.log('[tofu] schema: found the tables')
    return
  }

  const client = await pool.connect()
  const started = Date.now()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY])
    const waited = Date.now() - started
    // Read pg_class with this statement's own snapshot: to_regclass answers from a
    // cache that can still say "missing" for a table another start made meanwhile.
    const again = await client.query<{ tables: string }>(
      `SELECT count(*) AS tables FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('${DOCUMENTS}', '${AVATARS}')`,
    )
    if (Number(again.rows[0]?.tables) === 2) {
      await client.query('COMMIT')
      console.log(`[tofu] schema: already made by another start (waited ${waited} ms for the lock)`)
      return
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${DOCUMENTS} (
        name text PRIMARY KEY,
        doc jsonb NOT NULL,
        version bigint NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${AVATARS} (
        name text PRIMARY KEY,
        content_type text NOT NULL,
        bytes bytea NOT NULL,
        uploaded_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          ALTER TABLE public.${DOCUMENTS} ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.${AVATARS} ENABLE ROW LEVEL SECURITY;
        END IF;
      END
      $$`)
    await client.query('COMMIT')
    console.log(`[tofu] schema: made the tables (waited ${waited} ms for the lock)`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/**
 * A document as stored, made from its default the first time anyone asks. The
 * insert is `ON CONFLICT DO NOTHING` and the row is read again afterwards, so
 * two first requests at once store one document (one `admin`, never two) and
 * both read that one.
 */
export async function readDocument<T>(name: DataType): Promise<T> {
  await ensureSchema()
  const pool = getPool()
  const found = await pool.query<{ doc: T }>(
    `SELECT doc FROM public.${DOCUMENTS} WHERE name = $1`,
    [name],
  )
  if (found.rows[0]) return found.rows[0].doc
  await pool.query(
    `INSERT INTO public.${DOCUMENTS} (name, doc) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO NOTHING`,
    [name, JSON.stringify(DATA_DEFAULTS[name]())],
  )
  const made = await pool.query<{ doc: T }>(
    `SELECT doc FROM public.${DOCUMENTS} WHERE name = $1`,
    [name],
  )
  if (!made.rows[0]) throw new Error(`The ${name} document could not be read.`)
  return made.rows[0].doc
}

type Documents = Partial<Record<DataType, unknown>>

/**
 * Changes documents in one transaction, with their rows locked (`FOR UPDATE`,
 * always in the same order) from the read to the write. Upstream read a whole
 * file, changed it and wrote it back, so two requests at once could each write
 * over the other's change; here the second waits for the first and starts
 * from its result. `change` gets the current documents and returns the ones
 * to write; a document it leaves out is not written.
 */
export async function changeDocuments<R>(
  names: DataType[],
  change: (current: Documents) => Promise<{ write: Documents; result: R }> | { write: Documents; result: R },
): Promise<R> {
  const ordered = [...new Set(names)].sort()
  // Make every row exist first, so each one can be locked.
  for (const name of ordered) await readDocument(name)
  const client: PoolClient = await getPool().connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<{ name: DataType; doc: unknown }>(
      `SELECT name, doc FROM public.${DOCUMENTS}
       WHERE name = ANY($1::text[]) ORDER BY name FOR UPDATE`,
      [ordered],
    )
    const current: Documents = {}
    for (const row of locked.rows) current[row.name] = row.doc
    const { write, result } = await change(current)
    for (const name of Object.keys(write) as DataType[]) {
      if (!ordered.includes(name)) throw new Error(`${name} was not locked for this change.`)
      await client.query(
        `UPDATE public.${DOCUMENTS}
         SET doc = $2::jsonb, version = version + 1, updated_at = now()
         WHERE name = $1`,
        [name, JSON.stringify(write[name])],
      )
    }
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

/** One document changed under its row lock (see changeDocuments). */
export async function changeDocument<T, R = T>(
  name: DataType,
  change: (current: T) => Promise<{ doc: T; result: R }> | { doc: T; result: R },
): Promise<R> {
  return changeDocuments([name], async (current) => {
    const { doc, result } = await change(current[name] as T)
    return { write: { [name]: doc }, result }
  })
}

export async function saveAvatar(
  name: string,
  contentType: string,
  bytes: Buffer,
  uploadedBy: string,
): Promise<void> {
  await ensureSchema()
  await getPool().query(
    `INSERT INTO public.${AVATARS} (name, content_type, bytes, uploaded_by)
     VALUES ($1, $2, $3, $4)`,
    [name, contentType, bytes, uploadedBy],
  )
}

export async function readAvatar(
  name: string,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  await ensureSchema()
  const found = await getPool().query<{ content_type: string; bytes: Buffer }>(
    `SELECT content_type, bytes FROM public.${AVATARS} WHERE name = $1`,
    [name],
  )
  const row = found.rows[0]
  return row ? { contentType: row.content_type, bytes: row.bytes } : null
}
