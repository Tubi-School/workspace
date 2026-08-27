import { IsInt, IsISO8601, IsOptional, IsUrl, Min } from 'class-validator';

export class PublishRecordingDto {
  @IsUrl({ require_tld: false }, { message: 'recordingUrl must be a valid URL' })
  recordingUrl!: string;

  @IsOptional()
  @IsISO8601()
  availableFrom?: string;

  @IsInt()
  @Min(1)
  totalSeconds!: number;
}
