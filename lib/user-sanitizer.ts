// Modified by Tofu on 2026-10-28: the administrator account a new copy starts
// with signs in with HABITTROVE_ADMIN_PASSWORD, which the sign-in screen is
// told about (see TOFU.md).
import { PublicUserData, UserData } from './types'

export function sanitizeUserData(data: UserData, ownerPasswordSaved = false): PublicUserData {
  return {
    users: data.users.map(({ password, ...user }) => {
      const passwordFromSetting = !password && !!user.isAdmin
      return {
        ...user,
        hasPassword: !!password || (passwordFromSetting && ownerPasswordSaved),
        ...(passwordFromSetting && { passwordFromSetting }),
      }
    }),
  }
}
