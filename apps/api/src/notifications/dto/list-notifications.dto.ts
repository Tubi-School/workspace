import { IsEnum, IsOptional } from 'class-validator';

import { NotificationStatus } from '../../generated/prisma/client.js';

export class ListNotificationsDto {
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}
