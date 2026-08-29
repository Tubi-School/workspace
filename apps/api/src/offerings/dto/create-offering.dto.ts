import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { DeliveryMode } from '../../generated/prisma/client.js';

export class CreateOfferingDto {
  /** Trimmed before validation, so a whitespace-only value (e.g. "   ")
   * collapses to an empty string and is rejected by `@MinLength(1)`
   * rather than being accepted as a "real" name. */
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'name must not be empty or whitespace-only' })
  @MaxLength(200)
  name!: string;

  @IsEnum(DeliveryMode)
  deliveryMode!: DeliveryMode;

  /** ZAR, as a plain decimal string/number (e.g. 150.00) — stored as
   * Prisma `Decimal`, never a float in application code. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  monthlyPrice!: number;

  /** Courses this Offering grants access to. May be empty at creation —
   * an ADMIN can attach courses afterwards via the dedicated endpoint —
   * but a sellable Offering with zero courses grants no real access, so
   * the frontend should encourage supplying at least one. */
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  courseIds: string[] = [];
}
