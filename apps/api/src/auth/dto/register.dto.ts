import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Public self-registration input.
 *
 * Deliberately carries no `role` field. Public registration always creates a
 * LEARNER account (see AuthService.register) — a request body can never
 * choose its own role, let alone ADMIN. Provisioning TEACHER or ADMIN
 * accounts is out of scope for this milestone; see the Phase 2C completion
 * report for the founder decision this reflects.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;
}
