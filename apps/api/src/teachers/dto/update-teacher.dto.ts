import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deliberately does not allow changing `email` or `password` in this
 * milestone — credential rotation is a separate, more sensitive concern
 * than academic-structure/profile administration and is left for a later
 * phase rather than bolted on here.
 */
export class UpdateTeacherDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  /** Controlled deactivation/reactivation. Preferred over deletion — see
   * TeachersService for why this module exposes no delete endpoint. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
