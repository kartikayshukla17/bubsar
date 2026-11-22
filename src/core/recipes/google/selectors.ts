/**
 * Every selector the Google recipe uses on the OAuth web client page, by name. The name is
 * what a failure reports: "Google console layout changed: `<name>` not found."
 *
 * PROVISIONAL: recorded against the local stand-in, not the live console. Re-record against
 * the real client page (see BB-03 Real-world checks).
 *
 * Rules: prefer accessible names (`aria-label`), form-field names and roles over generated
 * class names; scope entry selectors to their section so the two lists can't mix; one line
 * on why each was chosen. Version 1 (2026-11-22, stand-in).
 */
export const SELECTORS = {
  /** The client's edit form, by its accessible name. Anchors the page: nothing is read without it. */
  clientForm: 'form[aria-label="OAuth client"]',
  /** The redirect URI section, by its accessible name (the heading Google shows). */
  redirectUris: 'section[aria-label="Authorized redirect URIs"]',
  /** Each redirect URI's text field, labelled "URIs N", in list order. */
  redirectUriInputs: 'section[aria-label="Authorized redirect URIs"] input[aria-label^="URIs "]',
  /** Each redirect URI's delete button, labelled "Delete URIs N": one per entry, a cross-check. */
  redirectUriDeletes:
    'section[aria-label="Authorized redirect URIs"] button[aria-label^="Delete URIs "]',
  /** The JavaScript origin section, by its accessible name. */
  jsOrigins: 'section[aria-label="Authorized JavaScript origins"]',
  /** Each origin's text field, labelled "URIs N" like the redirect list's. */
  jsOriginInputs: 'section[aria-label="Authorized JavaScript origins"] input[aria-label^="URIs "]',
  /** Each origin's delete button: one per entry, a cross-check. */
  jsOriginDeletes:
    'section[aria-label="Authorized JavaScript origins"] button[aria-label^="Delete URIs "]',
} as const;

export type SelectorName = keyof typeof SELECTORS;
