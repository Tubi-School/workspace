import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * ADMIN-only teacher provisioning input.
 *
 * Deliberately carries no `role` field — this endpoint always creates a
 * User with role TEACHER, exactly like RegisterDto never carries a role
 * for public self-registration. There is no code path through which a
 * caller of this endpoint — ADMIN or otherwise — can create an ADMIN
 * account.
 */
export class CreateTeacherDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  password!: string;

  @IsString()
  @MinLength(1, { message: 'fullName must not be empty' })
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
}
