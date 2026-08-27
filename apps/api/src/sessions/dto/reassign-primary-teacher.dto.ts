import { IsEnum, IsUUID } from 'class-validator';

/**
 * What happens to the outgoing PRIMARY teacher. Deliberately explicit and
 * required — this operation never infers the outgoing teacher's new state,
 * per the founder correction this DTO implements.
 */
export enum OutgoingPrimaryAction {
  BECOME_ASSISTANT = 'BECOME_ASSISTANT',
  BECOME_SUBSTITUTE = 'BECOME_SUBSTITUTE',
  REMOVE = 'REMOVE',
}

export class ReassignPrimaryTeacherDto {
  /** The TeacherProfile id who becomes PRIMARY. */
  @IsUUID()
  incomingTeacherId!: string;

  /** What the current PRIMARY teacher becomes once replaced. */
  @IsEnum(OutgoingPrimaryAction)
  outgoingTeacherAction!: OutgoingPrimaryAction;
}
