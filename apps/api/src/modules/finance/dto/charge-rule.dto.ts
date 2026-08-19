import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChargeCalculationMethod, ChargeType, UnitKind } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Charge rule DTOs — the stored, effective-dated formula (BM-03 §19/§52).
 *
 * WHY `configuration` IS A FREE-FORM OBJECT HERE and validated in the service
 * rather than by decorators: §12 requires the formula to be CONFIGURATION, and
 * each calculation method needs a different set of keys (FIXED wants `amount`,
 * AREA_BASED wants `totalCost`, ...). Expressing that as a discriminated union
 * of DTO classes would multiply the surface for no gain, because the engine
 * already validates the shape it needs and is the only thing that can — it is
 * the single place that knows what each method consumes.
 *
 * There is deliberately NO UpdateChargeRuleDto with an amount field. Editing a
 * live rule in place would silently change what past invoices claim to be based
 * on; a change is a NEW VERSION (§52), which is what `ReviseChargeRuleDto` does.
 */
export class CreateChargeRuleDto {
  @ApiProperty({ example: 'شارژ ماهانه', description: 'نام قانون شارژ' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ description: 'توضیح قانون' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: ChargeType, default: ChargeType.REGULAR })
  @IsOptional()
  @IsEnum(ChargeType)
  chargeType?: ChargeType;

  @ApiProperty({ enum: ChargeCalculationMethod })
  @IsEnum(ChargeCalculationMethod)
  calculationMethod!: ChargeCalculationMethod;

  /**
   * Method-specific inputs. Validated against the declared method by the
   * service, which delegates to the same engine that will later consume it —
   * so a rule that saves is a rule that can actually run.
   */
  @ApiProperty({
    description: 'پیکربندی محاسبه — کلیدها به روش محاسبه بستگی دارد',
    example: { amount: '2000000' },
  })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiProperty({ description: 'آغاز اعتبار قانون' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'پایان اعتبار (اختیاری، بازه نیم‌باز)' })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;

  @ApiPropertyOptional({ description: 'اولویت اجرا — کمتر زودتر', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  /** Empty/omitted = every non-archived unit of the building. */
  @ApiPropertyOptional({ enum: UnitKind, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(UnitKind, { each: true })
  appliesToUnitKinds?: UnitKind[];
}

/**
 * Supersedes an ACTIVE rule with version + 1 (§52).
 *
 * The old row is not touched — it stays as the thing past charges point at.
 * `effectiveFrom` of the new version is where the old one's effectivity ends,
 * so the timeline has no gap and no overlap.
 */
export class ReviseChargeRuleDto {
  @ApiProperty({
    description: 'پیکربندی تازه — نسخه جدید قانون با این مقادیر ساخته می‌شود',
    example: { amount: '2500000' },
  })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiProperty({ description: 'آغاز اعتبار نسخه تازه' })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({ description: 'توضیح نسخه تازه' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: UnitKind, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(UnitKind, { each: true })
  appliesToUnitKinds?: UnitKind[];
}

export class ArchiveChargeRuleDto {
  @ApiPropertyOptional({ description: 'پایان اعتبار — پیش‌فرض هم‌اکنون' })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}

export interface ChargeRuleResponse {
  id: string;
  name: string;
  description: string | null;
  chargeType: string;
  calculationMethod: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  status: string;
  configuration: Record<string, unknown>;
  appliesToUnitKinds: string[];
  createdAt: string;
}
