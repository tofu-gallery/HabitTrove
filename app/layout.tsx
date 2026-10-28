// Modified by Tofu on 2026-10-28: no service worker (public/sw.js only showed
// push notifications, which a copy on Tofu never sends), and a home-screen
// icon for iPhones (see TOFU.md).
import './globals.css'
import { DM_Sans } from 'next/font/google'
import { JotaiProvider } from '@/components/jotai-providers'
import { JotaiHydrate } from '@/components/jotai-hydrate'
import { loadSettings, loadHabitsData, loadCoinsData, loadWishlistData, loadUsersPublicData, loadServerSettings } from './actions/data'
import Layout from '@/components/Layout'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from "@/components/theme-provider"
import { SessionProvider } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Suspense } from 'react'
import LoadingSpinner from '@/components/LoadingSpinner'


// Inter (clean, modern, excellent readability)
// const inter = Inter({
//   subsets: ['latin'],
//   weight: ['400', '500', '600', '700']
// })

// Clean and contemporary
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700']
})

const activeFont = dmSans

export const metadata = {
  title: 'HabitTrove',
  description: 'Track your habits and get rewarded',
  icons: {
    apple: '/icons/web-app-manifest-192x192.png',
  },
}

export const dynamic = 'force-dynamic' // needed to prevent nextjs from caching the load... functions in Layout component

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale();
  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  const [initialSettings, initialHabits, initialCoins, initialWishlist, initialUsers, initialServerSettings] = await Promise.all([
    loadSettings(),
    loadHabitsData(),
    loadCoinsData(),
    loadWishlistData(),
    loadUsersPublicData(),
    loadServerSettings(),
  ])

  return (
    // set suppressHydrationWarning to true to prevent hydration errors when using ThemeProvider (https://ui.shadcn.com/docs/dark-mode/next)
    <html lang={locale} suppressHydrationWarning>
      <body className={activeFont.className}>
        <JotaiProvider>
          <Suspense fallback={<LoadingSpinner />}>
            <JotaiHydrate
              initialValues={{
                settings: initialSettings,
                habits: initialHabits,
                coins: initialCoins,
                wishlist: initialWishlist,
                users: initialUsers,
                serverSettings: initialServerSettings,
              }}
            >
              <NextIntlClientProvider locale={locale} messages={messages}>
                <ThemeProvider
                  attribute="class"
                  defaultTheme="system"
                  enableSystem
                  disableTransitionOnChange
                >
                  <SessionProvider>
                    <Layout>
                      {children}
                    </Layout>
                  </SessionProvider>
                </ThemeProvider>
              </NextIntlClientProvider>
            </JotaiHydrate>
          </Suspense>
        </JotaiProvider>
        <Toaster />
      </body>
    </html>
  )
}

