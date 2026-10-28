// Tofu: this file is Tofu's addition (2026-10-28), used by lib/store.ts (see TOFU.md).
import { createHash } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import { Pool, type PoolConfig } from 'pg'

// The connection-string parameters node-postgres takes its TLS settings from.
// Any of them in the URL replaces an `ssl` object passed beside it.
const URL_TLS_PARAMETERS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'uselibpqcompat',
]

/**
 * The pool configuration the app's queries use: DATABASE_URL, which a database
 * Tofu manages supplies.
 *
 * Tofu's DATABASE_URL carries `sslmode=require`, which node-postgres reads as
 * full verification, and the database's certificate chains to a root Node does
 * not ship (Tofu supplies it as SUPABASE_CA_CERT), so the URL on its own fails
 * with SELF_SIGNED_CERT_IN_CHAIN. When SUPABASE_CA_CERT is set, the URL's own
 * TLS parameters are removed and the server is verified against that root as
 * well as Node's own. Verification is never turned off.
 */
export function databasePoolConfig(): PoolConfig {
  const databaseUrl = process.env['DATABASE_URL']?.trim()
  if (!databaseUrl) {
    throw new Error(
      'No database configured: set DATABASE_URL to a PostgreSQL connection string.',
    )
  }
  const caCert = process.env['SUPABASE_CA_CERT']
  if (!caCert?.trim()) return { connectionString: databaseUrl }

  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    // Not the parser's own error, which would carry the URL and its password.
    throw new Error('DATABASE_URL must be a PostgreSQL URL.')
  }
  for (const name of URL_TLS_PARAMETERS) url.searchParams.delete(name)
  return {
    connectionString: url.toString(),
    ssl: { ca: [...rootCertificates, caCert], rejectUnauthorized: true },
  }
}

let pool: Pool | undefined

/**
 * One small pool per server process. Tofu's DATABASE_URL is the transaction
 * pooler (port 6543), which keeps no prepared statements between
 * transactions: node-postgres only prepares a statement when a query is given
 * a `name`, and nothing here names one.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...databasePoolConfig(),
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    })
    // An idle client the server dropped must not take the process down.
    pool.on('error', (error) => {
      console.error('[tofu] database pool error:', error.message)
    })
  }
  return pool
}

/**
 * The secret Auth.js signs sessions with: AUTH_SECRET when it is set, else one
 * derived from DATABASE_URL, so a copy signs people in from its first deploy
 * without anyone typing a secret. Only the app's hosting and its owner hold
 * DATABASE_URL, and anyone holding it can already change every row.
 */
export function authSecret(): string | undefined {
  const saved = process.env['AUTH_SECRET']?.trim()
  if (saved) return saved
  const databaseUrl = process.env['DATABASE_URL']?.trim()
  if (!databaseUrl) return undefined
  return createHash('sha256')
    .update('habittrove-auth-secret:' + databaseUrl)
    .digest('hex')
}
