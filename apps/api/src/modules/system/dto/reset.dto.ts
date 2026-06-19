import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export type ResetScope = 'production' | 'timeseries';

export class ResetSystemDto {
  /**
   * Which subsystem to reset:
   *  - 'production'  → deletes all production orders / work orders / job orders
   *                    and their dependent records from PostgreSQL.
   *  - 'timeseries'  → wipes the InfluxDB historian bucket only.
   */
  @IsIn(['production', 'timeseries'])
  scope!: ResetScope;

  /** When scope='production', also wipe the InfluxDB historian in the same run. */
  @IsOptional()
  @IsBoolean()
  wipeTimeseries?: boolean;

  /** The owner's current password — re-verified server-side before anything is deleted. */
  @IsString()
  @MinLength(1)
  password!: string;

  /** Safety phrase the operator must type exactly. Expected value: "RESET". */
  @IsString()
  confirmation!: string;
}
