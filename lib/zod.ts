// Modified by Tofu on 2026-10-28: a password may be up to 128 characters, so a
// long HABITTROVE_ADMIN_PASSWORD signs in (see TOFU.md).
import { literal, object, string } from "zod"

export const usernameSchema = string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be less than 20 characters")
  .regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric")

export const passwordSchema = string()
  .min(4, "Password must be more than 4 characters")
  .max(128, "Password must be at most 128 characters")
  .optional()
  .or(literal(''))

export const signInSchema = object({
  username: usernameSchema,
  password: passwordSchema,
})
