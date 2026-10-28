// Modified by Tofu on 2026-10-28: the data lives in PostgreSQL, so DATABASE_URL
// is required, and AUTH_SECRET is derived from it when it is unset (see TOFU.md).
import { z } from "zod"
import { authSecret } from "./tofu-database"

const zodEnv = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  DEMO: z.string().optional(),
})

declare global {
  interface ProcessEnv extends z.TypeOf<typeof zodEnv> {
    AUTH_SECRET: string;
    DEMO?: string;
  }
}

export function init() {
  if (!process.env.AUTH_SECRET?.trim()) {
    const derived = authSecret()
    if (derived) process.env.AUTH_SECRET = derived
  }
  try {
    zodEnv.parse(process.env)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const { fieldErrors } = err.flatten()
      const errorMessage = Object.entries(fieldErrors)
        .map(([field, errors]) =>
          errors ? `${field}: ${errors.join(", ")}` : field,
        )
        .join("\n ")

      throw new Error(
        `Missing environment variables:\n ${errorMessage}`,
      )
    }
  }
}
