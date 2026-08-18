import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { VerificationStatus } from '@prisma/client';

/**
 * Shared verification shapes for ownership and occupancy — BM-02 §31/§32.
 *
 * ONE DTO FOR BOTH RELATIONSHIPS ON PURPOSE. The two flows are identical in
 * everything that matters (a reviewer decides, records a reason, and the
 * decision is audited), and duplicating them invites the pair to drift until
 * "verified" means something subtly different depending on which table it is
 * stored in.
 *
 * WHAT THE BODY CANNOT SAY IS AGAIN THE SECURITY: there is no `verifiedBy`
 * field. The reviewer is always the authenticated caller, read from the proven
 * scope. A body that could name its own reviewer would let a manager attribute
 * an approval to a colleague who never saw the deed.
 */

/** Trims a string and returns undefined for blanks, so optional stays optional. */
const trimmed = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const next = value.trim();
  return next === '' ? undefined : next;
};

/**
 * The subset of `VerificationStatus` a reviewer may set directly.
 *
 * `UNVERIFIED` is excluded because it means "never looked at", and a reviewer
 * who has looked cannot make that true again — reopening a decision is
 * `PENDING`, which is a different and honest statement. `EXPIRED` is excluded
 * because lapsing is a consequence of time (a lease ending), not a judgement
 * someone types in.
 */
export type ReviewableVerificationStatus = Extract<
  VerificationStatus,
  'PENDING' | 'VERIFIED' | 'REJECTED'
>;

/** Records a reviewer's decision about a claimed relationship. */
export class DecideVerificationDto {
  @IsIn(['PENDING', 'VERIFIED', 'REJECTED'], {
    message: 'وضعیت تأیید انتخابی معتبر نیست',
  })
  status!: ReviewableVerificationStatus;

  /**
   * Reviewer's reason. Optional in the DTO but REQUIRED by the service when
   * `status` is REJECTED — a rejection with no stated reason is unappealable,
   * and the person it affects is entitled to know what to fix.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trimmed)
  note?: string;
}

/** Verification facts attached to an ownership/occupancy response. */
export interface VerificationSummary {
  readonly status: VerificationStatus;
  readonly verifiedAt: Date | null;
  /**
   * Reviewer's person id — NOT their name or contact.
   *
   * BM-02 §45: the caller can resolve the id through the member directory if
   * they are entitled to see that person at all. Inlining the name here would
   * leak a manager's identity to every reader of an ownership row, including
   * roles that hold OWNERSHIP_READ but no MEMBER_READ.
   */
  readonly verifiedByPersonId: string | null;
  readonly note: string | null;
}
