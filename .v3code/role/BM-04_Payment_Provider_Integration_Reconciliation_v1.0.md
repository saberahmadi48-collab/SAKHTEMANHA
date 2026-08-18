# BM-04 — Payment Provider Integration & Reconciliation
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-04 defines the payment integration layer for the Building Management Platform.

The primary objective is:

> **A resident/owner must be able to press one payment button, complete payment through a supported payment provider, and have the platform automatically verify, reconcile, receipt, and post the payment to the correct financial account.**

The manager must NOT manually enter successful payments as the normal workflow.

BM-04 builds on:

- BM-00 — Product Constitution
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger

---

# 2. Core Product Principle

The payment experience should be:

```text
Invoice
   ↓
[پرداخت]
   ↓
Payment Provider
   ↓
Provider Result
   ↓
Server Verification
   ↓
Payment
   ↓
Ledger
   ↓
Invoice Settlement
   ↓
Receipt
```

The user should not need to:

- Ask the manager for bank information
- Manually enter the payable amount
- Send a payment screenshot
- Ask the manager to confirm payment
- Wait for manual ledger entry

---

# 3. Critical Architecture Rule

The core Finance domain must NOT depend directly on:

```text
AP
724
AnyBank
AnyFutureProvider
```

Instead:

```text
Finance Domain
      ↓
Payment Abstraction
      ↓
Provider Adapter
      ↓
AP / 724 / Future Provider
```

---

# 4. Payment Provider Abstraction

Recommended interface:

```text
IPaymentProvider
```

Conceptual methods:

```text
CreatePaymentIntent()
GetPaymentUrl()
VerifyPayment()
GetTransactionStatus()
RefundPayment()
```

The exact interface may vary according to provider capabilities.

---

# 5. Payment Provider Adapter

Each provider must have its own adapter.

Example:

```text
PaymentProvider
├── APAdapter
├── Provider724Adapter
└── FutureProviderAdapter
```

The Finance domain must remain unaware of provider-specific implementation details.

---

# 6. Provider Configuration

Provider configuration should be stored securely.

Recommended:

```text
PaymentProviderConfiguration
----------------------------
Id
Provider
BuildingId
MerchantIdentifier
TerminalIdentifier
Status
EffectiveFrom
EffectiveTo
ConfigurationReference
CreatedAt
UpdatedAt
```

Secrets must NOT be stored as plaintext business configuration.

Use secure secret storage where available.

---

# 7. Building Payment Provider

A Building may have one active primary payment provider.

Example:

```text
Building A
   ↓
AP

Building B
   ↓
724
```

The platform should be able to support multiple providers in the future.

---

# 8. Provider Selection

Provider selection may depend on:

```text
Building
Organization
Payment Method
Availability
Configuration
```

The client must not be allowed to select an arbitrary provider and bypass server configuration.

---

# 9. Payment Intent

PaymentIntent represents the intention to pay a specific financial obligation.

Recommended:

```text
PaymentIntent
----------------------------
Id
BuildingId
UnitId
InvoiceId
Amount
Currency
Provider
Status
IdempotencyKey
CreatedAt
ExpiresAt
CompletedAt
```

---

# 10. Critical Amount Rule

The client must NOT define the authoritative amount.

Bad:

```json
{
  "invoiceId": "123",
  "amount": 1000
}
```

Correct:

```text
InvoiceId
   ↓
Server loads Invoice
   ↓
Server determines payable balance
   ↓
PaymentIntent.Amount
```

The amount must come from trusted server-side financial data.

---

# 11. Payment Intent Lifecycle

Recommended:

```text
Created
 ↓
Initiated
 ↓
Redirected
 ↓
PendingVerification
 ↓
Succeeded
```

Alternative:

```text
Failed
Cancelled
Expired
```

---

# 12. Payment Session

A PaymentIntent may create a provider session.

Recommended:

```text
PaymentSession
----------------------------
Id
PaymentIntentId
Provider
ProviderSessionId
PaymentUrl
CreatedAt
ExpiresAt
Status
```

Do not store sensitive provider credentials in the session.

---

# 13. Payment Button UX

Invoice screen:

```text
--------------------------------
Invoice #1405-01-000101

Amount Due:
5,000,000

Due Date:
1405/01/31

[ پرداخت ]
--------------------------------
```

The button triggers server-side PaymentIntent creation.

---

# 14. Payment Redirect

Recommended flow:

```text
User
 ↓
POST /payments/intents
 ↓
Server validates invoice
 ↓
Server creates PaymentIntent
 ↓
Server calls provider
 ↓
Provider returns payment URL
 ↓
Client redirects
```

---

# 15. Return URL

After payment, the provider may redirect the user back to the platform.

The return page is informational only.

Example:

```text
/payment/result/{paymentIntentId}
```

The platform must NOT treat the return URL alone as proof of payment.

---

# 16. Server-Side Verification

Mandatory:

```text
Provider Callback / Return
        ↓
Server
        ↓
Provider Verification API
        ↓
Verify:
- transaction
- amount
- merchant
- reference
- status
        ↓
Payment Succeeded
```

---

# 17. Amount Verification

The verified provider amount must equal the trusted PaymentIntent amount.

If:

```text
Expected = 5,000,000
Provider = 4,000,000
```

the transaction must NOT be settled automatically.

Generate:

```text
FinancialException
```

---

# 18. Invoice Verification

Before settlement:

```text
PaymentIntent.InvoiceId
        ↓
Invoice exists?
        ↓
Invoice belongs to same Building?
        ↓
Invoice belongs to same Unit?
        ↓
Invoice still payable?
```

If not:

```text
Reject / Exception
```

---

# 19. Payment Provider Transaction

Recommended:

```text
PaymentTransaction
----------------------------
Id
PaymentIntentId
Provider
ProviderTransactionId
ProviderReference
Amount
Currency
Status
VerifiedAt
RawReference
CreatedAt
```

Sensitive raw provider payload should be stored only when required and protected.

---

# 20. Provider Callback

Provider callbacks must be:

- Authenticated where provider supports it
- Validated
- Idempotent
- Logged
- Verified server-side

Never trust:

```text
status=success
```

from an unverified client request.

---

# 21. Callback Idempotency

If provider sends:

```text
Callback A
Callback A
Callback A
```

result must be:

```text
One payment
One ledger effect
One settlement
One receipt
```

---

# 22. Idempotency Key

Every PaymentIntent should have a unique idempotency key.

Example:

```text
payment-intent-{GUID}
```

The platform must reject duplicate creation when the same logical request is replayed.

---

# 23. Duplicate Payment Protection

Before creating a new payment intent:

```text
Invoice Balance
+
Existing Pending PaymentIntents
+
Recently Succeeded Payments
```

must be evaluated.

The system should prevent accidental double payment where appropriate.

---

# 24. Concurrent Payment Protection

Scenario:

```text
User opens two browser tabs
Tab A → Pay
Tab B → Pay
```

The backend must prevent inconsistent settlement.

Use:

- Transaction boundaries
- Idempotency
- Concurrency control
- Payment status checks

---

# 25. Successful Payment Processing

After provider verification:

```text
Payment = Succeeded
        ↓
Ledger Entry
        ↓
Invoice Paid / PartiallyPaid
        ↓
Receipt
        ↓
Notification
```

All financial state changes must be atomic where possible.

---

# 26. Ledger Posting

A successful payment must generate exactly the intended financial effect.

Do not allow:

```text
Payment Succeeded
but Ledger Not Updated
```

without an exception/reconciliation path.

---

# 27. Transaction Boundary

Recommended conceptual transaction:

```text
Verify Payment
     ↓
Begin DB Transaction
     ↓
Create Payment Record
     ↓
Create Ledger Entry
     ↓
Update Invoice Settlement
     ↓
Create Receipt
     ↓
Commit
```

External provider calls must not be held inside a long database transaction.

---

# 28. Outbox / Reliable Event Pattern

Where appropriate, use an outbox pattern for:

- Receipt notification
- Email
- SMS
- Push
- Reconciliation event
- Financial event propagation

This prevents successful payment from being lost because notification failed.

---

# 29. Receipt

Successful payments automatically produce receipts.

Recommended:

```text
Receipt
----------------------------
Id
BuildingId
UnitId
PaymentId
ReceiptNumber
Amount
Currency
IssuedAt
Status
```

Receipt number must be unique.

---

# 30. Receipt Content

Minimum:

```text
Building
Unit
Payer
Invoice
Amount
Date
Payment Provider
Provider Reference
Receipt Number
```

Sensitive information must be minimized.

---

# 31. Payment Failure

If payment fails:

```text
PaymentIntent = Failed
```

No successful ledger settlement is created.

User should see:

```text
پرداخت ناموفق بود.
لطفاً دوباره تلاش کنید.
```

Do not expose provider technical secrets.

---

# 32. Payment Expiration

Payment sessions may expire.

Example:

```text
Created
 ↓
Pending
 ↓
Expired
```

An expired intent cannot be settled unless the provider confirms success through verification.

---

# 33. Refund

Refund must be handled separately from a new payment.

Flow:

```text
Payment
 ↓
Refund Request
 ↓
Authorization
 ↓
Provider Refund
 ↓
Provider Verification
 ↓
Ledger Reversal / Refund Entry
```

The original payment remains immutable.

---

# 34. Partial Refund

The architecture should support:

```text
Payment = 10,000,000
Refund = 3,000,000
Remaining settled amount = 7,000,000
```

Do not assume every refund is full.

---

# 35. Failed Refund

If provider refund fails:

```text
Payment remains successful
Refund remains failed/pending
FinancialException may be created
```

Do not mark the original payment refunded prematurely.

---

# 36. Reconciliation

Reconciliation compares:

```text
Internal Platform
        ↕
Payment Provider
        ↕
Settlement Account
```

---

# 37. Reconciliation Job

Recommended scheduled process:

```text
Daily / Configured Interval
        ↓
Load successful provider transactions
        ↓
Load platform successful payments
        ↓
Match
        ↓
Detect mismatches
        ↓
Create exceptions
```

---

# 38. Reconciliation Match Keys

Preferred matching hierarchy:

```text
ProviderTransactionId
ProviderReference
PaymentIntentId
Amount
Date/Time
Invoice Reference
```

Do not rely only on:

```text
Amount + Date
```

for automatic matching.

---

# 39. Reconciliation States

Recommended:

```text
Matched
MissingInPlatform
MissingAtProvider
AmountMismatch
Duplicate
UnknownTransaction
Pending
Resolved
```

---

# 40. Financial Exception

Recommended:

```text
FinancialException
----------------------------
Id
BuildingId
Type
Severity
ReferenceType
ReferenceId
ExpectedAmount
ActualAmount
Description
Status
CreatedAt
ResolvedAt
ResolvedBy
```

---

# 41. Exception Severity

Suggested:

```text
Low
Medium
High
Critical
```

Examples:

### Low

Delayed provider status.

### Medium

Duplicate callback.

### High

Amount mismatch.

### Critical

Payment provider reports success but internal settlement is missing.

---

# 42. Exception Resolution

Resolution must be explicit.

```text
Open
 ↓
Investigating
 ↓
Resolved
```

or:

```text
Open
 ↓
Rejected / False Positive
```

Resolution must be audited.

---

# 43. Manual Reconciliation

Authorized financial staff may resolve exceptions.

Manual resolution must never silently edit a successful payment.

Use:

```text
Adjustment
Reversal
Correction
```

with reason and audit.

---

# 44. Settlement Account

The Building's destination account is configured independently from the payment provider.

Example:

```text
Building
 ↓
SettlementAccount
 ↓
IBAN / Account
```

The platform should support:

- Account holder
- IBAN
- Bank
- Provider
- Effective date
- Verification status

---

# 45. Settlement Account Privacy

Bank details are highly sensitive.

Rules:

- Never expose full IBAN to general users unless required.
- Never expose account credentials.
- Mask sensitive values in logs.
- Encrypt sensitive data at rest where appropriate.
- Restrict access to authorized management/finance roles.

---

# 46. Manager Change and Payment Account

Changing the building manager does NOT create a new building.

The financial history remains attached to:

```text
BuildingId
```

The settlement account may change through an authorized process.

Example:

```text
Building
├── Account A (historical)
└── Account B (current)
```

---

# 47. Payment Provider Failure

If provider is unavailable:

```text
PaymentIntent creation
→ Failed / ProviderUnavailable
```

The invoice must remain unchanged.

The user should be able to retry.

---

# 48. Provider Timeout

If the provider times out:

```text
Do not assume failure
Do not assume success
```

Set:

```text
PendingVerification
```

and perform status verification/reconciliation.

---

# 49. Provider Maintenance

Provider status may be monitored.

If unavailable:

```text
Payment button
→ Disabled / Alternative Provider
```

depending on configured provider availability.

---

# 50. Multiple Providers

Future-compatible model:

```text
Building
 ├── AP
 ├── 724
 └── Future Provider
```

The system may select a provider based on configured rules.

The user should not need to understand the underlying provider architecture.

---

# 51. Payment Security

Mandatory:

- HTTPS
- Authentication
- Authorization
- Server-side amount validation
- Provider verification
- Idempotency
- Replay protection
- Audit
- Secure secrets
- No card data storage by the platform unless explicitly required and compliant

Prefer redirect/hosted payment pages so the platform does not handle card credentials.

---

# 52. Sensitive Data

Do NOT store:

- Card PIN
- CVV
- Online banking password
- Provider secret in logs
- Full authentication tokens

Only store transaction information required for reconciliation/audit.

---

# 53. Logging

Logs may contain:

```text
PaymentIntentId
BuildingId
InvoiceId
Provider
ProviderTransactionId
Status
Timestamp
```

Logs must NOT contain:

```text
Card credentials
Passwords
API secrets
Private tokens
```

---

# 54. API Boundaries

Suggested endpoints:

```text
POST /api/payments/intents
GET  /api/payments/intents/{id}
GET  /api/payments/{id}
POST /api/payments/{id}/verify
POST /api/payments/{id}/refund

GET  /api/payment/result/{paymentIntentId}

POST /api/payment-providers/{provider}/callback
```

Provider callbacks must not bypass domain verification.

---

# 55. Provider Callback Authentication

Where supported, validate:

- Signature
- Secret
- Merchant ID
- Terminal ID
- Transaction ID
- Amount
- Timestamp
- Replay protection

Provider-specific requirements belong inside the adapter.

---

# 56. Provider Adapter Contract

Conceptual:

```text
CreatePayment
    Input:
        PaymentIntent

    Output:
        ProviderSession
        PaymentUrl
        ProviderReference
```

```text
VerifyPayment
    Input:
        ProviderReference

    Output:
        VerificationResult
```

```text
RefundPayment
    Input:
        Payment
        RefundAmount

    Output:
        RefundResult
```

---

# 57. Provider Verification Result

Recommended:

```text
VerificationResult
----------------------------
IsSuccessful
ProviderTransactionId
ProviderReference
VerifiedAmount
Currency
ProviderStatus
VerifiedAt
```

The Finance domain consumes normalized results rather than provider-specific response formats.

---

# 58. Currency Verification

Provider currency must match the PaymentIntent currency.

Mismatch:

```text
FinancialException
```

No automatic settlement.

---

# 59. Building Scope Verification

Every payment operation must verify:

```text
PaymentIntent.BuildingId
Invoice.BuildingId
Unit.BuildingId
```

All must be consistent.

---

# 60. Unit Scope Verification

Payment must be associated with the correct Unit.

A user cannot use their own payment authorization to pay/modify another Unit's invoice unless explicitly authorized.

---

# 61. Authorization

Recommended baseline:

### Resident/Owner

Can:

- View own invoices
- Create payment for own payable balance
- View own payment history
- Download own receipts

### Manager

Can:

- View building payments
- View reconciliation
- Configure provider
- Configure settlement account if authorized
- Resolve financial exceptions according to permission

### Accountant

Can:

- View financial records
- Reconcile
- Resolve financial exceptions
- Issue approved refunds/adjustments according to policy

### Platform Admin

Can:

- Manage provider infrastructure
- Support troubleshooting
- Not silently alter financial history

---

# 62. Payment History

User view:

```text
Payment Date
Invoice
Amount
Provider
Status
Receipt
```

Building manager view:

```text
Unit
Payer
Invoice
Amount
Provider
Transaction
Status
Date
```

Sensitive payment details remain restricted.

---

# 63. Notification

After success:

```text
Payment Successful
Receipt Available
```

After failure:

```text
Payment Failed
Retry
```

After reconciliation exception:

```text
Internal alert
```

Do not expose internal reconciliation problems to ordinary residents unless necessary.

---

# 64. Financial Consistency Rules

The following must always hold:

```text
Successful Payment
        ⇒
Verified Provider Transaction
```

```text
Verified Payment
        ⇒
Valid Invoice/Financial Reference
```

```text
Ledger Settlement
        ⇒
Successful Payment or Authorized Financial Entry
```

```text
Refunded Payment
        ⇒
Verified Refund
```

---

# 65. Anti-Double-Settlement Rule

A provider transaction may settle only once.

Recommended database protection:

```text
Unique(
    Provider,
    ProviderTransactionId
)
```

plus application-level idempotency.

---

# 66. Reconciliation Dashboard

Minimum manager/accountant view:

```text
Today's Payments
Successful
Pending
Failed
Exceptions
Unmatched
Amount Mismatches
Refunds
```

---

# 67. Operational Monitoring

System monitoring should track:

- Provider availability
- Payment success rate
- Verification latency
- Callback failures
- Reconciliation failures
- Duplicate callbacks
- Amount mismatches
- Refund failures

---

# 68. Metrics

Minimum payment KPIs:

```text
Payment Success Rate
Payment Failure Rate
Verification Success Rate
Average Verification Time
Unmatched Transaction Count
Reconciliation Exception Count
Refund Success Rate
```

---

# 69. Retry Policy

Retries must be controlled.

Safe to retry:

- Provider status query
- Reconciliation query
- Notification

Potentially unsafe without idempotency:

- Payment creation
- Refund creation

Every retryable operation must have a defined idempotency strategy.

---

# 70. Failure Recovery

The system must recover from:

```text
Provider timeout
Database timeout
Callback duplication
Application restart
Network interruption
Provider delayed confirmation
```

without creating duplicate financial effects.

---

# 71. Data Retention

Payment records must remain available according to applicable financial/legal retention requirements.

Do not delete:

- Successful payment history
- Receipt history
- Reconciliation history
- Audit records

through normal user deletion.

---

# 72. Testing Requirements

Mandatory automated tests:

### Payment

- Successful payment
- Failed payment
- Timeout
- Expired session
- Amount mismatch
- Currency mismatch
- Wrong invoice
- Wrong building
- Duplicate callback
- Duplicate transaction
- Concurrent payment

### Refund

- Full refund
- Partial refund
- Failed refund
- Duplicate refund request

### Security

- Cross-building access
- Cross-unit access
- Unauthorized provider configuration
- Unauthorized settlement account change
- Callback spoofing
- Replay attack
- IDOR/BOLA

### Reconciliation

- Matched transaction
- Missing internal transaction
- Missing provider transaction
- Amount mismatch
- Duplicate provider transaction

---

# 73. Definition of Done

BM-04 is **COMPLETE** only when:

1. Payment provider abstraction exists.
2. At least one real provider adapter is integrated.
3. PaymentIntent works.
4. Payment URL/redirect works.
5. Provider verification works.
6. Provider callbacks are validated.
7. Payment callbacks are idempotent.
8. Amount verification works.
9. Invoice settlement works.
10. Ledger posting works.
11. Receipt generation works.
12. Refund architecture works.
13. Reconciliation works.
14. Financial exceptions work.
15. Settlement account configuration works.
16. Sensitive provider credentials are protected.
17. Cross-building authorization works.
18. Automated payment/security tests pass.
19. Provider failure recovery works.
20. No direct provider dependency exists in Finance core.

---

# 74. Explicit Non-Goals

Do not implement in BM-04:

- Full accounting
- Banking core
- Card storage
- Card credentials
- Provider-specific logic inside Finance domain
- Manual payment as primary workflow
- Service provider marketplace
- Maintenance management
- Election management
- AI

---

# 75. BM-04 Architecture Gate

Mandatory separation:

```text
Invoice
   ≠
PaymentIntent
   ≠
ProviderTransaction
   ≠
Payment
   ≠
LedgerEntry
   ≠
Receipt
```

And:

```text
Payment Provider
   ≠
Financial Ledger
```

The provider confirms a transaction.

The platform owns its financial record.

---

# 76. Final Principle

> **Payment must be a controlled, verifiable, idempotent financial event—not a button that changes a balance. The platform must trust verified provider transactions, preserve immutable history, reconcile discrepancies, and keep the manager out of routine manual payment entry.**

---

## BM-04 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger

**Next Phase:** BM-05 — Building Operations, Maintenance & Service Provider Network

**Implementation Rule:** AP/724 must be implemented only as provider adapters behind the approved payment abstraction. No provider-specific implementation may leak into the Finance domain.
