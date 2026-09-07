import { IsString, IsArray, IsObject, IsOptional, IsNumber } from 'class-validator';

/**
 * Two ways to ask for a prediction, matching what ml-service accepts.
 *
 *   events + roles   the live path. Features are computed by ml-service's
 *                    canonical extractor - the same code that builds the
 *                    training set, which is what keeps training and serving
 *                    from drifting apart (L5).
 *   features         pre-computed. Used by the model sandbox, which exists to
 *                    put a chosen feature vector in front of the classifier;
 *                    there is no session to extract from.
 *
 * `features` used not to be declared here at all, even though ml-service has
 * always supported it. With a global whitelisting ValidationPipe an undeclared
 * property is not ignored, it is rejected - so the sandbox could not use this
 * endpoint and called ml-service straight from the browser instead, past the
 * JWT guard and with the service's URL compiled into the client bundle.
 */
export class PredictPairStateDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsArray()
  events?: Array<Record<string, any>>;

  @IsOptional()
  @IsObject()
  roles?: Record<string, string>;

  @IsOptional()
  @IsNumber()
  lastRoleSwitchAt?: number;

  @IsOptional()
  @IsNumber()
  sessionStartAt?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, number>;
}
