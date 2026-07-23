// Dispatcher (Cycle 2 multi-agent; see docs/MULTI_AGENT.md).
//
// This is the one deliberate, narrow exception to the app's "no hand-written
// intent parsing" principle. Its ONLY job is to select which agent sees a turn
// -- dairy, vendor, or both. It never inspects tool arguments and never decides
// what action to take; each agent still reasons over its own tools exactly as
// before. `both` is the safe default whenever a turn could span both domains
// (reconciliation questions live there), so an over-eager single-domain match
// is deliberately avoided.

import type { AgentKind } from '@dairy/shared';

export type Agent = AgentKind;

// Word-boundary matched (see anyMatch) so short tokens don't match inside
// longer words. Keep these single alphanumeric words.
// Note: unit words like "litre(s)" are deliberately NOT here -- they're shared
// with the vendor domain (a delivery is measured in litres too), so keying on
// them would route almost every delivery command to `both` and erase the
// distinction. Milk questions carry "milk"/"yield"/"produce" regardless.
const DAIRY_KEYWORDS = [
  'animal', 'animals', 'herd', 'milk', 'milking', 'milkings', 'yield', 'yields',
  'produce', 'produced', 'production', 'feed', 'fodder', 'silage', 'bran',
  'concentrate', 'health', 'vaccination', 'vaccine', 'vet', 'treatment',
  'breeding', 'calf', 'calves', 'buffalo', 'buffaloes', 'cow', 'cows',
  'lactating', 'pregnant', 'group', 'kundi', 'nili', 'ravi',
];

const VENDOR_KEYWORDS = [
  'vendor', 'vendors', 'delivery', 'deliveries', 'deliver', 'delivered',
  'sold', 'sell', 'sale', 'sales', 'buy', 'buys', 'buying', 'bought',
  'buyer', 'buyers', 'customer', 'customers', 'balance', 'paid', 'unpaid',
  'payment', 'invoice', 'price', 'priced',
];

// Reconciliation cues. These force `both` even without a keyword from each
// domain (e.g. "any discrepancy last week?"). Cross-domain phrasings like
// "does the milk we produce match what we deliver?" already resolve to `both`
// via one dairy + one vendor hit.
const RECON_KEYWORDS = ['reconcile', 'reconciliation', 'discrepancy', 'mismatch'];

// Comparison cues. On their own they don't pick a domain, but a single-domain
// turn that carries one is usually relating THIS turn to the previous one
// ("does that match what we delivered?", "how does it compare?"). Combined with
// a domain switch since the last turn, that's a cross-domain follow-up.
const COMPARE_KEYWORDS = [
  'match', 'matches', 'matched', 'compare', 'compared', 'comparison',
  'vs', 'versus', 'against',
];

// Self-contained: lowercases internally so any caller is safe (keywords are all
// lowercase static [a-z] literals, so no regex-escaping is needed).
function anyMatch(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
}

/** Domain routing from a single message in isolation (no conversational context). */
function baseSelect(t: string): Agent {
  if (anyMatch(t, RECON_KEYWORDS)) return 'both';

  const dairyHit = anyMatch(t, DAIRY_KEYWORDS);
  const vendorHit = anyMatch(t, VENDOR_KEYWORDS);

  if (dairyHit && !vendorHit) return 'dairy';
  if (vendorHit && !dairyHit) return 'vendor';

  // Ambiguous, spanning both, or matching neither -> the safe default.
  return 'both';
}

/**
 * Pick the agent for a turn. `previousUserText` (the prior user-typed message,
 * when there is one) lets a terse cross-domain follow-up be routed correctly:
 * the dispatcher otherwise only sees the latest message, so "does that match
 * what we delivered?" after a production question would route vendor-only and
 * miss the reconciliation tool. When the latest turn is single-domain, carries
 * a comparison cue, and the previous turn was a DIFFERENT domain, we escalate
 * to `both`. Same-domain comparisons ("compare Kundi vs Nili-Ravi") stay put.
 */
export function selectAgent(latestUserText: string, previousUserText?: string): Agent {
  const t = latestUserText.toLowerCase();
  const base = baseSelect(t);

  if ((base === 'dairy' || base === 'vendor') && previousUserText && anyMatch(t, COMPARE_KEYWORDS)) {
    const prev = baseSelect(previousUserText.toLowerCase());
    // Only escalate on a genuine domain switch: the previous turn was the OTHER
    // specific domain. A prior `both`/ambiguous turn must not turn a real
    // single-domain comparison ("compare Kundi vs Nili-Ravi") into `both`.
    if ((prev === 'dairy' || prev === 'vendor') && prev !== base) return 'both';
  }

  return base;
}
