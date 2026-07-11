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
//  Confusable rule: the indistinguishable bare-vertical family is
//  { i, I, lowercase l, digit 1 } -> ALL folded to 'l'. Folding both cases of i
//  keeps two promises at once: case-insensitivity ("Indonesia" == "indonesia")
//  AND look-alike protection (nobody registers "AIlen" to impersonate "Allen").
//  Result: simon / s1mon / slmon COLLIDE (all -> "slmon"); allen / a11en / AIlen
//  collide. 0/o and other leetspeak pairs are intentionally left distinct.
//  Multi-char homoglyphs (rn≈m, vv≈w, cl≈d) are not folded — add only for maximum
//  strictness, and only BEFORE names exist, never after.
//
//  HISTORICAL NOTE: an earlier rule folded only { I, l, 1 } and left lowercase i
//  distinct, which leaked case-sensitivity through the letter i — so @indonesia
//  and @Indonesia both minted (different skeletons). That pair is grandfathered
//  in the DB via handles.skeleton_exempt + a partial unique index; it is a
//  frozen one-time artifact and cannot recur under this rule.
// =============================================================================

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

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
    return "Handles must be 1–15 chars: A–Z, a–z, 0–9, and underscore.";
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
  // fold the entire bare-vertical family to 'l': lowercase i, capital I,
  // lowercase l, digit 1. Case no longer leaks (both i and I fold the same way).
  s = s.replace(/[Iil1]/g, "l");
  // lowercase the rest -> case-insensitive uniqueness. 0 and leet pairs untouched.
  return s.toLowerCase();
}

// Examples:
//   skeleton("SimonCain") -> "slmoncaln"
//   skeleton("simoncain") -> "slmoncaln"   (same handle — case-insensitive)
//   skeleton("Indonesia") -> "lndonesla"
//   skeleton("indonesia") -> "lndonesla"   (same handle — the old rule leaked this)
//   skeleton("s1mon")     -> "slmon"        (collides with simon/slmon — blocked)
//   skeleton("sim0n")     -> "slm0n"        (0 stays distinct — claimable)
//   skeleton("Allen")     -> "allen"
//   skeleton("a11en")     -> "allen"        (collision — blocked)
//   skeleton("AIlen")     -> "allen"        (collision — capital-I homoglyph blocked)
