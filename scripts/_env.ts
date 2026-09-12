export function requireContact(): string {
  const c = process.env.EDGAR_CONTACT;
  if (!c) { console.error("EDGAR_CONTACT is not set. Add it to .env.local (see .env.example)."); process.exit(2); }
  return c;
}
