// Imported first by index.ts so variables from .env (GOOGLE_CLIENT_ID, WAITUP_DB, ...) exist
// before any other module reads process.env. A missing .env is fine.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file */
}
