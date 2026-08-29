import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

/** Deliberately does not allow changing `deliveryMode` after creation —
 * SessionEntitlementSnapshot rows already reference an Offering's
 * deliveryMode indirectly through SubscriptionAccess at the moment
 * entitlement was evaluated (frozen semantics); changing it retroactively
 * would reinterpret historical entitlement. An ADMIN who needs a
 * different delivery mode creates a new Offering instead. */
export class UpdateOfferingDto {
  /** Trimmed before validation, matching CreateOfferingDto — a
   * whitespace-only value is rejected rather than silently accepted. */
  @IsOptional()
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'name must not be empty or whitespace-only' })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monthlyPrice?: number;
}
