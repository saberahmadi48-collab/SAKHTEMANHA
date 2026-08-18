/**
 * Contact-detail masking — the single implementation of BM-00 rule 6 and
 * BM-02 §24/§25/§26.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED: masking that lives next to each
 * endpoint drifts. One list starts returning raw phone numbers because someone
 * added a `select` there and forgot the helper, and the leak is invisible in
 * review because every file "looks like it masks". Privacy rules that differ by
 * file are privacy rules that do not exist, so every endpoint that returns a
 * person routes through here.
 *
 * BM-02 §45 (response minimization) is the companion rule: these helpers decide
 * what a contact field LOOKS like, while the caller decides whether to include
 * the field at all. A directory listing should not ask for an email it has no
 * business showing.
 */

/** The fields any person-shaped row must expose for masking to be decidable. */
export interface MaskablePerson {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
  /** The person's own consent flag — see `shouldRevealContact`. */
  readonly phoneIsPublic: boolean;
}

/** A person as shown in any list. Contact fields may be masked. */
export interface PersonSummary {
  readonly personId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
  /** True when the values above are masked, so the UI can say so honestly. */
  readonly contactMasked: boolean;
}

/**
 * Decides whether a caller may see a person's real contact details.
 *
 * TWO INDEPENDENT GATES, and the OR between them is deliberate:
 *
 *  - `canSeeContact` — the caller holds PERSON_READ_CONTACT. The manager tier
 *    has it because someone must be able to reach a resident about a burst pipe.
 *  - `phoneIsPublic` — the person themselves opted in to being reachable by
 *    other members.
 *
 * Either is sufficient, because they answer different questions: "is this
 * caller trusted with contact data" and "did this person agree to be listed".
 * Consent is not erased by authority and authority is not blocked by the
 * absence of consent — collapsing them into one flag loses one of those facts.
 */
export function shouldRevealContact(
  person: Pick<MaskablePerson, 'phoneIsPublic'>,
  canSeeContact: boolean,
): boolean {
  return canSeeContact || person.phoneIsPublic;
}

/**
 * Maps a Person row onto the list summary, masking contact fields unless the
 * caller is entitled to them.
 *
 * Note the name fields are NOT masked. BM-02 §24 classes a resident's display
 * name as building-scoped rather than private: neighbours knowing who lives in
 * the building is the point of a directory. Phone, email and identity data are
 * the private class, and those are what this masks.
 */
export function toPersonSummary(
  person: MaskablePerson,
  canSeeContact: boolean,
): PersonSummary {
  const reveal = shouldRevealContact(person, canSeeContact);

  return {
    personId: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    displayName: person.displayName,
    email: reveal ? person.email : maskEmail(person.email),
    phoneNumber: reveal ? person.phoneNumber : maskPhone(person.phoneNumber),
    contactMasked: !reveal,
  };
}

/**
 * "sara@example.com" -> "s***@example.com".
 *
 * Keeps the domain because it is the useful half for a human confirming they
 * have the right person, and reveals only the first character of the local
 * part. Returns "***" for anything without a usable "@" rather than echoing the
 * raw string — a malformed address must not leak by falling through.
 */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * "09121234567" -> "0912***4567".
 *
 * Short values collapse to "***" entirely: masking the middle of a 7-character
 * string leaves so little hidden that it is not masking at all.
 */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

/**
 * "۰۰۱۲۳۴۵۶۷۸" -> "******5678" for a national id.
 *
 * BM-02 §24 puts identity references in the PRIVATE class, and unlike a phone
 * number there is no legitimate directory use for one — so this reveals only
 * enough for a manager to confirm a document matches, never enough to reuse the
 * number elsewhere.
 */
export function maskNationalId(nationalId: string | null): string | null {
  if (!nationalId) return null;
  if (nationalId.length <= 4) return '***';
  return `${'*'.repeat(nationalId.length - 4)}${nationalId.slice(-4)}`;
}
