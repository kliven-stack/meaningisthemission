/** Site-wide switches that a project lead may want to flip without touching markup. */

/**
 * How the two lead-capture forms render.
 *
 * - `growthmap`  — our own static forms, POSTing to `PUBLIC_CONTACT_ENDPOINT`
 *                  (playbook §4b). This is the migration target.
 * - `embed`      — the original LeadConnector / GoHighLevel iframes, byte-identical
 *                  to the WordPress site. They are served from `verified.trustymail.co`,
 *                  a GoHighLevel host that outlives the WordPress install, so they are
 *                  a safe fallback until the Growthmap endpoint exists.
 *
 * With no endpoint configured the embeds are kept regardless, so a deploy that
 * happens before the endpoint is created never ships a form that goes nowhere.
 */
export const FORM_MODE: 'growthmap' | 'embed' =
  (import.meta.env.PUBLIC_FORM_MODE as 'growthmap' | 'embed') || 'growthmap';

/** Growthmap lead endpoint (public by design — it is read in the browser). */
export const CONTACT_ENDPOINT = import.meta.env.PUBLIC_CONTACT_ENDPOINT || '';

/** The GoHighLevel chat bubble the WordPress footer loads on every page. */
export const CHAT_WIDGET = (import.meta.env.PUBLIC_CHAT_WIDGET || 'on') !== 'off';

/**
 * The "Free Chapter Opt In" popup every page opens five seconds after load.
 *
 * On by default because that is what production does. It is the one piece of the
 * clone a client is likely to want switched off without a code change, so it gets
 * its own flag rather than an edit to the fragment.
 */
export const OPT_IN_POPUP = (import.meta.env.PUBLIC_OPT_IN_POPUP || 'on') !== 'off';

/**
 * Whether the pages keep WordPress's `noindex, nofollow`.
 *
 * `on` is the default because it is what production serves — every URL on the
 * WordPress site, home page included, carries `noindex, nofollow`, to Googlebot as
 * much as to anyone else. It is almost certainly not intended; see the README's
 * "Original-site bugs". Setting `PUBLIC_NOINDEX=off` drops the tag and lets the
 * sitemap do its job, without touching markup.
 */
export const NOINDEX = (import.meta.env.PUBLIC_NOINDEX || 'on') !== 'off';

export const SITE_NAME = 'Meaning Is The Mission';
