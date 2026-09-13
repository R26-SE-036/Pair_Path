import { IsIn } from 'class-validator';

import { CONSENT_DECISIONS } from '../../../content/research-consent';

export class DecideConsentDto {
  @IsIn([...CONSENT_DECISIONS])
  decision!: string;
}
