// Modified by Tofu on 2026-10-28: no backup scheduler (Tofu runs no process
// between requests), and the start makes the database tables (see TOFU.md).

// Ensure this function is exported
export async function register() {
  // We only want to run this code on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@/lib/env.server') // startup env var check
    // Initialize environment variables first
    init();
    console.log('Environment variables initialized.');

    // Tofu: make the tables now, under one lock shared by every start (lib/store.ts).
    // A failure is logged, not fatal: the first request tries again.
    try {
      const { ensureSchema } = await import('@/lib/store');
      await ensureSchema();
    } catch (error) {
      console.error('[tofu] schema step failed; the first request tries again:', error instanceof Error ? error.message : error);
    }
  } else {
    console.log(`Instrumentation hook running in environment: ${process.env.NEXT_RUNTIME}. Skipping server-side initialization.`);
  }
}
