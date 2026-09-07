import { IsBoolean } from 'class-validator';

/**
 * Whether the pair found a nudge useful.
 *
 * The body used to be typed inline as `{ accepted: boolean }`, which is a
 * TypeScript annotation and not a runtime check - the global ValidationPipe
 * only validates DTO classes, so `accepted` arrived as whatever was sent and
 * Prisma stored the string "false" as `true`. `accepted` is the only outcome
 * measure this component has for whether interventions land, so it is the last
 * field that should be taken on trust.
 */
export class RespondToInterventionDto {
  @IsBoolean()
  accepted: boolean;
}
