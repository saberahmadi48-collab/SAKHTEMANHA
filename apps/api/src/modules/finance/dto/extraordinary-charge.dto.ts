import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChargeCalculationMethod, ChargeType, UnitKind } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Extraordinary charge — the one-off assessment (BM-03 §20).
 *
 * WHAT MAKES THIS DIFFERENT FROM A CHARGE RULE: a rule is standing configuration
 * that every monthly run re-applies. An extraordinary charge happens ONCE — a
 * lift replacement, a roof repair, an emergency — and creating a permanent rule
 * for it would mean the building keeps billing for a lift it already replaced
 * until someone remembers to archive it.
 *
 * §20 lists exactly what such a charge must carry, and each is a field here:
 * reason, amount, calculation rule, approval reference, financial period, audit
 * record. `reason` and `approvalReference` are the two that exist purely for
 * accountability — an unexplained levy on a resident's invoice is the fastest
 * way to lose a building's trust, and §20 makes the reason mandatory rather than
 * optional for that reason.
 *
 * It still runs through the SAME calculation engine as a monthly rule. Splitting
 * 500,000,000 across units by area is the identical problem as splitting a
 * monthly cost by area, including the lost-Rial rounding that `apportion` solves
 * (§14) — a second implementation would eventually disagree with the first.
 */
export class CreateExtraordinaryChargeDto {
  @ApiProperty({ example: 'تعویض کابین آسانسور', description: 'عنوان شارژ' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  /**
   * §20 — mandatory, and validated as non-blank by the service.
   *
   * This is the sentence a resident reads when they ask "what is this charge?".
   * A system that accepted an empty reason would produce exactly the unexplained
   * line item the section exists to prevent.
   */
  @ApiProperty({ description: 'دلیل شارژ فوق‌العاده — الزامی طبق §۲۰' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  /** Board minute, assembly vote or contract number that authorised the levy. */
  @ApiPropertyOptional({ description: 'مرجع تصویب — شماره صورت‌جلسه یا مصوبه' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  approvalReference?: string;

  @ApiProperty({
    enum: ChargeType,
    default: ChargeType.EXTRAORDINARY,
    description: 'نوع شارژ — پیش‌فرض فوق‌العاده',
  })
  @IsOptional()
  @IsEnum(ChargeType)
  chargeType?: ChargeType;

  @ApiProperty({ enum: ChargeCalculationMethod })
  @IsEnum(ChargeCalculationMethod)
  calculationMethod!: ChargeCalculationMethod;

  /**
   * Method-specific inputs, identical in shape to a charge rule's — FIXED wants
   * `amount`, AREA_BASED wants `totalCost`. Validated by running the real engine,
   * so a configuration that saves is one that can execute.
   */
  @ApiProperty({
    description: 'پیکربندی محاسبه — کلیدها به روش محاسبه بستگی دارد',
    example: { totalCost: '500000000' },
  })
  @IsObject()
  configuration!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'شناسه دوره مالی — پیش‌فرض دوره جاری' })
  @IsOptional()
  @IsUUID()
  financialPeriodId?: string;

  /** Empty/omitted = every active unit of the building. */
  @ApiPropertyOptional({ enum: UnitKind, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(UnitKind, { each: true })
  appliesToUnitKinds?: UnitKind[];
}

export interface ExtraordinaryChargeResponse {
  financialPeriodId: string;
  title: string;
  reason: string;
  approvalReference: string | null;
  calculationMethod: string;
  unitsCharged: number;
  totalAmount: number;
  chargeIds: string[];
}
