// =============================================================================
//  handleSkeleton.ts
//  Handles allow MIXED CASE for display (existing authors used capitals).
//  Case is cosmetic: uniqueness is CASE-INSENSITIVE (the skeleton lowercases),
//  so "SimonCain" and "simoncain" are the same handle — only one can be minted,
//  and it keeps its chosen capitalization on screen.
//
//  The mint engine MUST compute the skeleton with this function and check it
//  against handles.handle_skeleton and reserved_handles.handle_skeleton before
//  minting. The DB unique index on handle_skeleton is the backstop; this is the
//  gate.
//
//  Confusable rule: among letters + digits the indistinguishable bare-vertical
//  set is { capital I, lowercase l, digit 1 } -> folded to 'l' BEFORE lowercasing
//  (so capital I joins the family while dotted lowercase i stays distinct).
//  Result: simon / s1mon / sim0n stay distinct; allen / a11en / AIlen collide.
//  0/o and leetspeak pairs are intentionally left distinct. Multi-char homoglyphs
//  (rn≈m, vv≈w, cl≈d) are not folded — add only for maximum strictness, and only
//  BEFORE launch, never after names exist.
// =============================================================================

const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/;

/** Display form — case PRESERVED; just strip invisibles. Stored in handles.handle. */
export function displayHandle(raw: string): string {
  return raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

/**
 * Validate handle syntax. Returns an error string, or null if valid.
 * Rejecting all non-ASCII removes the entire Unicode-homoglyph attack surface.
 */
export function validateHandleSyntax(raw: string): string | null {
  const h = displayHandle(raw);
  if (!HANDLE_RE.test(h)) {
    return "Handles must be 1–30 chars: A–Z, a–z, 0–9, and underscore.";
  }
  if (h.startsWith("_") || h.endsWith("_")) {
    return "Handles can’t start or end with an underscore.";
  }
  if (h.includes("__")) {
    return "Handles can’t contain consecutive underscores.";
  }
  return null;
}

/** Uniqueness skeleton. Assumes validateHandleSyntax() has passed. */
export function skeleton(raw: string): string {
  let s = displayHandle(raw);
  // fold the bare-vertical family BEFORE lowercasing: capital I, lowercase l,
  // digit 1 -> 'l'. (Dotted lowercase i is NOT in the class, so it stays distinct.)
  s = s.replace(/[Il1]/g, "l");
  // lowercase the rest -> case-insensitive uniqueness. 0 and leet pairs untouched.
  return s.toLowerCase();
}

// Examples:
//   skeleton("SimonCain") -> "simoncain"
//   skeleton("simoncain") -> "simoncain"  (same handle — case-insensitive)
//   skeleton("s1mon")     -> "slmon"       (distinct from Simon/simon — claimable)
//   skeleton("sim0n")     -> "sim0n"       (distinct — claimable)
//   skeleton("Allen")     -> "allen"
//   skeleton("a11en")     -> "allen"        (collision — blocked)
//   skeleton("AIlen")     -> "allen"        (collision — capital-I homoglyph blocked)
