import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AttemptReason } from '../../database/entities';

/**
 * Refusals that carry a machine-readable reason.
 *
 * The attendance layer has to file a refusal under a reason code so the
 * notification list can say "no face was visible" rather than "verification
 * failed", and so a mismatch can record *how far* off it was. Deriving that by
 * matching on message text would work today and break silently the first time
 * a sentence is reworded.
 *
 * Each class extends the exception that was already being thrown, so the HTTP
 * status every existing caller sees is unchanged -- 401 for a mismatch, 400 for
 * a malformed or missing capture. Only the classification is new.
 */

/** The capture did not contain a usable face. */
export class NoFaceSuppliedError extends BadRequestException {
  readonly reasonCode = AttemptReason.NO_FACE;
}

/** The employee has nothing to compare against. */
export class NoEnrollmentError extends BadRequestException {
  readonly reasonCode = AttemptReason.NOT_ENROLLED;
}

/** A face was read, but it was not this employee's. */
export class FaceMismatchError extends UnauthorizedException {
  readonly reasonCode = AttemptReason.FACE_MISMATCH;

  /** Match confidence (1 - distance) of the closest enrolled template. */
  readonly matchScore: number;

  constructor(message: string, matchScore: number) {
    super(message);
    this.matchScore = matchScore;
  }
}

/**
 * The reason code on a thrown refusal, or FACE_ERROR when it was something
 * unclassified -- an unexpected failure should still reach the admin rather
 * than being swallowed.
 */
export function reasonCodeOf(error: unknown): AttemptReason {
  const code = (error as { reasonCode?: AttemptReason })?.reasonCode;
  return code ?? AttemptReason.FACE_ERROR;
}

/** The match confidence on a thrown refusal, when it recorded one. */
export function matchScoreOf(error: unknown): number | null {
  const score = (error as { matchScore?: number })?.matchScore;
  return typeof score === 'number' && Number.isFinite(score) ? score : null;
}
