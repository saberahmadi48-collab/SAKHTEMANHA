import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

export type SupportedProviderName = 'AP' | '724';
export type ProviderTransactionStatus =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REVERSED';

export interface PaymentProviderVerificationInput {
  provider: SupportedProviderName;
  buildingId: string;
  unitId: string;
  invoiceId: string | null;
  amount: Prisma.Decimal;
  currency: string;
  providerTransactionId: string;
  idempotencyKey: string;
}

export interface PaymentProviderVerificationResult {
  provider: SupportedProviderName;
  providerTransactionId: string;
  amount: Prisma.Decimal;
  currency: string;
  merchantId: string;
  status: ProviderTransactionStatus;
  verifiedAt: Date;
  rawReference?: string;
  note?: string;
}

export interface PaymentProviderAdapter {
  verifyTransaction(
    input: PaymentProviderVerificationInput,
  ): Promise<PaymentProviderVerificationResult>;
}

export const PAYMENT_PROVIDER_ADAPTER = Symbol('PAYMENT_PROVIDER_ADAPTER');

@Injectable()
export class TestPaymentProviderAdapter implements PaymentProviderAdapter {
  constructor(private readonly config: ConfigService) {}

  async verifyTransaction(
    input: PaymentProviderVerificationInput,
  ): Promise<PaymentProviderVerificationResult> {
    const providerTransactionId = input.providerTransactionId.trim();
    const merchantId =
      this.config.get<string>('PAYMENT_PROVIDER_MERCHANT_ID') ??
      `${input.provider.toLowerCase()}-test-merchant`;

    const normalized = providerTransactionId.toLowerCase();
    if (normalized.includes('forge') || normalized.includes('tamper')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'FAILED',
        verifiedAt: new Date(),
        note: 'provider verification rejected before settlement',
      };
    }

    if (normalized.includes('pending')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'PENDING',
        verifiedAt: new Date(),
        note: 'provider is still processing the transaction',
      };
    }

    if (normalized.includes('cancel')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'CANCELLED',
        verifiedAt: new Date(),
        note: 'provider cancelled payment before capture',
      };
    }

    if (normalized.includes('expire')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'EXPIRED',
        verifiedAt: new Date(),
        note: 'provider session expired before authorization',
      };
    }

    if (normalized.includes('fail')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'FAILED',
        verifiedAt: new Date(),
        note: 'provider reported a failed authorization',
      };
    }

    if (normalized.includes('reverse')) {
      return {
        provider: input.provider,
        providerTransactionId,
        amount: input.amount,
        currency: input.currency,
        merchantId,
        status: 'REVERSED',
        verifiedAt: new Date(),
        note: 'provider result was reversed after settlement',
      };
    }

    return {
      provider: input.provider,
      providerTransactionId,
      amount: input.amount,
      currency: input.currency,
      merchantId,
      status: 'SUCCEEDED',
      verifiedAt: new Date(),
      rawReference: `${input.idempotencyKey}:${providerTransactionId}`,
      note: 'server-side test adapter accepted the provider outcome',
    };
  }
}
