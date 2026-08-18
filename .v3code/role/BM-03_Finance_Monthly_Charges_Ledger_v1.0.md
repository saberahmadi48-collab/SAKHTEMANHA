# BM-03 — Finance, Monthly Charges & Ledger
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-03 establishes the financial foundation of the Building Management Platform.

The objective is to make building finance:

- Transparent
- Auditable
- Automated
- Building-scoped
- Unit-aware
- Payment-provider independent
- Resistant to manual errors
- Ready for future accounting integration

BM-03 must comply with:

- BM-00 — Product Constitution
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership

---

# 2. Core Financial Principle

The platform must not be designed as:

> "A page where the manager enters how much each resident owes."

It must be designed as:

```text
Building Financial Rules
        ↓
Charge Calculation
        ↓
Charge / Invoice
        ↓
Payment
        ↓
Payment Verification
        ↓
Ledger
        ↓
Unit Balance
        ↓
Building Financial Position
```

The manager should configure and supervise the financial system, not manually maintain every transaction.

---

# 3. Finance Domain Boundaries

BM-03 owns:

- Financial account
- Unit ledger
- Building ledger
- Charge definitions
- Charge periods
- Charge calculation
- Invoice
- Invoice lines
- Payment intent foundation
- Payment transaction foundation
- Expense
- Income
- Adjustment
- Refund
- Reversal
- Credit balance
- Debit balance
- Financial categories
- Financial periods
- Receipts
- Financial audit

BM-03 does NOT directly implement:

- Specific payment gateway
- AP/724 implementation
- Maintenance Work Order
- Service Provider marketplace
- Election
- Advanced accounting/tax engine
- AI financial prediction

---

# 4. Financial Architecture

The recommended model is:

```text
Building
   ↓
Financial Configuration
   ↓
Charge Period
   ↓
Charge
   ↓
Invoice
   ↓
Payment
   ↓
Ledger Entry
```

Expenses use a separate operational path:

```text
Building
   ↓
Expense
   ↓
Approval
   ↓
Payment
   ↓
Ledger Entry
```

---

# 5. Building Financial Account

Every Building requires a financial context.

Recommended:

```text
BuildingFinancialAccount
----------------------------
Id
BuildingId
Currency
Status
FiscalYear
CreatedAt
UpdatedAt
```

A Building must not share its financial ledger with another Building.

---

# 6. Unit Financial Account

Every financially participating Unit should have a ledger.

Recommended:

```text
UnitFinancialAccount
----------------------------
Id
BuildingId
UnitId
Currency
Status
CreatedAt
UpdatedAt
```

This account is the financial view of the Unit.

It is not the user's bank account.

---

# 7. Ledger Principle

The ledger is the source of truth for financial state.

Do not calculate the balance only from:

```text
Invoice - Payment
```

without a persistent financial record.

Recommended:

```text
LedgerEntry
----------------------------
Id
BuildingId
UnitId nullable
FinancialPeriodId
EntryType
Debit
Credit
Amount
Currency
ReferenceType
ReferenceId
Description
CreatedAt
CreatedBy
```

---

# 8. Double-Entry Direction

Even if the first product version does not expose full accounting functionality, the internal model should be compatible with double-entry principles.

Conceptually:

```text
Debit
Credit
```

Every financial event must have a defined financial effect.

Do not implement arbitrary "balance += amount" logic.

---

# 9. Financial Period

Financial activity should be grouped by period.

Recommended:

```text
FinancialPeriod
----------------------------
Id
BuildingId
Year
Month
StartDate
EndDate
Status
ClosedAt
ClosedBy
```

Possible statuses:

```text
Open
Closing
Closed
Reopened
```

---

# 10. Period Closure

A closed period must not be freely edited.

Corrections should use:

- Adjustment
- Reversal
- Refund
- Correction entry

rather than destructive editing.

Reopening a closed period must require elevated permission and audit.

---

# 11. Monthly Charge

Monthly charge is a calculated financial obligation.

Recommended:

```text
Charge
----------------------------
Id
BuildingId
UnitId
FinancialPeriodId
ChargeType
CalculationMethod
BaseAmount
CalculatedAmount
Status
GeneratedAt
```

Possible ChargeType:

```text
Regular
Extraordinary
Utility
Repair
Penalty
Credit
Other
```

---

# 12. Charge Calculation

The system must support configurable formulas.

Minimum calculation models:

```text
Fixed
AreaBased
FixedPlusArea
PerPerson
ConsumptionBased
Custom
```

Example:

```text
Monthly Charge =
Fixed Component
+
Area Component
+
Shared Cost Component
+
Other Configured Components
```

The formula must be stored as configuration, not buried in controller code.

---

# 13. Fixed Charge

Example:

```text
All Units = 2,000,000
```

Each unit receives the same base charge.

---

# 14. Area-Based Charge

Example:

```text
Charge = Total Cost × Unit Area / Eligible Area
```

Area must come from the Unit master data.

Finance must not duplicate Unit area in an unrelated table unless there is a justified snapshot requirement.

---

# 15. Fixed + Area

Example:

```text
Fixed Component = 1,000,000

Area Component =
Total Area Cost × Unit Area / Total Eligible Area
```

Final:

```text
Charge = Fixed + Area Component
```

---

# 16. Per-Person

Where permitted:

```text
Charge = Rate × Eligible Resident Count
```

The calculation must use an explicit period snapshot.

Historical charges must not change merely because a resident later moves in or out.

---

# 17. Consumption-Based

Future-compatible design:

```text
Meter
 ↓
Reading
 ↓
Consumption
 ↓
Charge
```

BM-03 only establishes the calculation interface.

Full meter/utility management may be implemented later.

---

# 18. Charge Snapshot

Once a charge is generated, the system should preserve the calculation result.

Recommended:

```text
ChargeCalculationSnapshot
----------------------------
FormulaVersion
Inputs
Values
CalculatedAmount
CalculatedAt
```

This prevents historical charges from changing when configuration changes later.

---

# 19. Charge Configuration

Recommended:

```text
ChargeRule
----------------------------
Id
BuildingId
Name
ChargeType
CalculationMethod
EffectiveFrom
EffectiveTo
Priority
Status
Configuration
```

Charge rules must be effective-dated.

---

# 20. Extraordinary Charge

The building may create extraordinary charges for:

- Major repair
- Elevator replacement
- Painting
- Roof repair
- Emergency work
- Capital improvement
- Other approved building expenses

Extraordinary charges must have:

- Reason
- Amount
- Calculation rule
- Approval/reference
- Financial period
- Audit record

---

# 21. Invoice

A Charge represents an obligation.

An Invoice represents a payable document/financial request.

Recommended:

```text
Invoice
----------------------------
Id
BuildingId
UnitId
FinancialPeriodId
InvoiceNumber
IssueDate
DueDate
Subtotal
Discount
Penalty
Total
PaidAmount
Balance
Status
```

---

# 22. Invoice Lines

Recommended:

```text
InvoiceLine
----------------------------
Id
InvoiceId
ChargeId
Description
Quantity
UnitPrice
Amount
```

An invoice may contain multiple charges.

Example:

```text
Invoice 1405-01-101

Monthly Charge
Elevator Repair
Cleaning
Extraordinary Charge
--------------------
Total
```

---

# 23. Invoice Numbering

Invoice numbering must be:

- Unique
- Auditable
- Configurable
- Predictable

Example:

```text
1405-01-000101
```

The exact format may be configurable.

Invoice number must not be reused after issuance.

---

# 24. Invoice Lifecycle

Recommended:

```text
Draft
 ↓
Issued
 ↓
PartiallyPaid
 ↓
Paid
```

Alternative states:

```text
Overdue
Cancelled
Reversed
Refunded
```

A paid invoice must not simply be deleted.

---

# 25. Partial Payment

The system must support partial payments.

Example:

```text
Invoice = 5,000,000

Payment 1 = 2,000,000
Payment 2 = 3,000,000

Status:
PartiallyPaid → Paid
```

---

# 26. Overpayment

The platform must support overpayment.

Example:

```text
Invoice = 5,000,000
Payment = 5,500,000
```

The excess:

```text
500,000
```

must become a credit balance rather than disappearing.

---

# 27. Credit Balance

Recommended:

```text
UnitCredit
----------------------------
Id
BuildingId
UnitId
Amount
Currency
SourceReference
CreatedAt
Status
```

Credit may later be applied to future charges.

---

# 28. Outstanding Balance

A Unit's financial position should be derived from ledger entries.

Conceptually:

```text
Opening Balance
+
New Charges
+
Penalties
+
Other Debits
-
Payments
-
Credits
-
Refunds
=
Outstanding Balance
```

The exact accounting implementation may use debit/credit ledger semantics.

---

# 29. Payment

Payment is an external financial event that must be verified.

Recommended:

```text
Payment
----------------------------
Id
BuildingId
UnitId
InvoiceId nullable
PaymentIntentId
Provider
ProviderTransactionId
Amount
Currency
Status
RequestedAt
VerifiedAt
CreatedAt
```

---

# 30. Payment Status

Recommended:

```text
Created
Pending
Succeeded
Failed
Cancelled
Expired
RefundPending
Refunded
Reversed
```

Only verified successful payments may settle financial obligations.

---

# 31. Payment Gateway Abstraction

BM-03 must define:

```text
IPaymentProvider
```

The core finance domain must not directly depend on:

```text
AP
724
```

or any other specific provider.

Future providers should be pluggable.

---

# 32. Payment Flow

Target flow:

```text
User
 ↓
Pay Invoice
 ↓
Create Payment Intent
 ↓
Open Payment Provider
 ↓
User Completes Payment
 ↓
Provider Callback
 ↓
Server Verification
 ↓
Payment Succeeded
 ↓
Ledger Entry
 ↓
Invoice Settlement
 ↓
Receipt
```

---

# 33. Critical Payment Rule

Returning from the payment provider does NOT prove payment success.

The server must verify the transaction with the payment provider.

Only after successful verification:

```text
Payment = Succeeded
```

and:

```text
Ledger Entry = Created
```

---

# 34. Idempotency

Payment callbacks must be idempotent.

If the same callback is received multiple times:

```text
One Payment
One Ledger Effect
```

must result.

Never create duplicate financial entries because a provider retries a callback.

---

# 35. Provider Transaction ID

The provider transaction/reference ID must be stored.

Recommended unique constraint:

```text
Provider
+
ProviderTransactionId
```

This prevents duplicate settlement.

---

# 36. Manual Payment

Manual payment entry may exist as a controlled fallback.

It must NOT be the primary workflow.

If enabled:

- Require elevated permission
- Require payment reference
- Require evidence where appropriate
- Audit creator
- Audit approval
- Prevent duplicate reference
- Never silently alter the ledger

---

# 37. Payment Receipt

Successful payment should automatically generate a receipt.

Receipt includes:

- Building
- Unit
- Payer
- Invoice
- Amount
- Payment date
- Provider
- Transaction reference
- Receipt number

---

# 38. Expense

Building expenses are first-class financial records.

Recommended:

```text
Expense
----------------------------
Id
BuildingId
CategoryId
VendorName
Description
Amount
Currency
ExpenseDate
InvoiceReference
Status
CreatedBy
ApprovedBy
CreatedAt
```

---

# 39. Expense Approval

Depending on configured building policy:

```text
Draft
 ↓
Submitted
 ↓
Approved
 ↓
Paid
```

Alternative:

```text
Rejected
Cancelled
```

Approval authority must be role-based.

---

# 40. Expense vs Maintenance Cost

A maintenance Work Order may generate a cost.

The Finance module must receive the financial result without duplicating the operational Work Order.

Example:

```text
Work Order
   ↓
Provider Invoice
   ↓
Approved Expense
   ↓
Payment
   ↓
Ledger
```

This integration belongs to later phases.

---

# 41. Income

Building income may include:

- Monthly charges
- Extraordinary charges
- Rental income where applicable
- Penalties
- Other approved income

Recommended:

```text
Income
----------------------------
Id
BuildingId
CategoryId
Amount
Currency
Date
ReferenceType
ReferenceId
Description
```

---

# 42. Financial Categories

Categories should be configurable.

Example:

```text
Income
├── Monthly Charges
├── Extraordinary Charges
└── Other

Expense
├── Cleaning
├── Elevator
├── Electricity
├── Water
├── Security
├── Repairs
├── Insurance
└── Other
```

Do not hard-code all categories in business logic.

---

# 43. Penalty / Late Fee

The system may support late fees.

Recommended configuration:

```text
PenaltyRule
----------------------------
BuildingId
EffectiveFrom
EffectiveTo
CalculationMethod
Rate
GracePeriod
MaximumAmount
Status
```

Possible models:

```text
Fixed
Percentage
Daily
Monthly
```

Penalty rules must be legally/configurably controlled.

---

# 44. Financial Adjustment

Adjustments are controlled corrections.

Example:

```text
Wrong Charge
↓
Adjustment
↓
Correct Balance
```

Never silently modify historical amounts.

Adjustment must contain:

- Reason
- Amount
- Reference
- CreatedBy
- ApprovedBy where required
- Timestamp

---

# 45. Refund

Refund is a financial reversal of a previous payment.

Recommended flow:

```text
Payment
 ↓
Refund Requested
 ↓
Approved
 ↓
Provider Refund
 ↓
Verified
 ↓
Ledger Reversal
```

The original Payment must remain.

---

# 46. Reversal

Reversal corrects an erroneous financial event.

Example:

```text
Incorrect Ledger Entry
       ↓
Reversal Entry
       ↓
Correct Entry
```

Never delete the original financial event.

---

# 47. Financial Audit

Every sensitive financial action must be audited.

At minimum:

- Charge creation
- Charge rule changes
- Invoice issuance
- Payment initiation
- Payment callback
- Payment verification
- Refund
- Reversal
- Adjustment
- Expense creation
- Expense approval
- Expense payment
- Financial period closure
- Settlement account changes

---

# 48. Settlement Account

The Building may configure its settlement destination.

Recommended entity:

```text
SettlementAccount
----------------------------
Id
BuildingId
AccountHolder
Bank
IBAN
AccountNumber
PaymentProvider
VerificationStatus
EffectiveFrom
EffectiveTo
Status
```

Sensitive bank information must be protected.

---

# 49. Settlement Account Changes

When management changes, the new manager may configure a new settlement account according to authorization rules.

Historical accounts must remain available as historical records.

Example:

```text
2025
Account A

2026
Account B
```

The Building remains the same.

---

# 50. Monthly Charge Generation

The system should support automated generation.

Example:

```text
Month Starts
    ↓
Open Financial Period
    ↓
Load Active Charge Rules
    ↓
Calculate Each Eligible Unit
    ↓
Create Charges
    ↓
Create Invoices
    ↓
Notify Members
```

Manual manager-by-manager entry is prohibited as the normal workflow.

---

# 51. Charge Generation Idempotency

Running the monthly charge process twice must not create duplicate charges.

Recommended uniqueness concept:

```text
Building
+
Unit
+
FinancialPeriod
+
ChargeRule
+
Version
```

The exact constraint may vary, but duplicate generation must be impossible or safely detected.

---

# 52. Charge Calculation Versioning

If the manager changes the monthly formula:

```text
Version 1
Version 2
Version 3
```

Old invoices retain the calculation snapshot that produced them.

New rules affect future periods only unless a controlled recalculation is explicitly authorized.

---

# 53. Financial Dashboard

Minimum Manager dashboard:

```text
Total Receivables
Collected This Month
Outstanding
Overdue
Expenses
Net Position
Collection Rate
Number of Unpaid Units
```

Unit dashboard:

```text
Current Balance
Current Invoice
Payment History
Receipts
Outstanding Amount
```

---

# 54. Resident/Owner Finance View

A resident/owner should be able to see:

- Current balance
- Current invoice
- Due date
- Payment button
- Payment history
- Receipts
- Credits
- Adjustments relevant to their account

They must not see another unit's financial data.

---

# 55. Payment UX

Primary action:

```text
[ پرداخت ]
```

The user should not need to:

- Enter amount manually
- Enter bank account
- Send screenshot
- Ask manager for confirmation

The amount should come from the invoice.

---

# 56. Payment Provider UX

Target:

```text
Invoice
   ↓
[پرداخت]
   ↓
Payment Provider
   ↓
Return
   ↓
Server Verification
   ↓
Success / Failure
```

The exact provider interface is implementation-specific.

---

# 57. Financial Reports

Minimum reports:

### Building

- Income
- Expenses
- Receivables
- Payments
- Outstanding balances
- Collection rate
- Monthly financial statement

### Unit

- Account statement
- Charges
- Payments
- Outstanding
- Credits

### Manager

- Monthly performance
- Collection status
- Expense breakdown

---

# 58. Export

The system should support export to:

- Excel
- CSV
- PDF

Exports must respect authorization.

A resident must never be able to export the whole building's financial ledger.

---

# 59. Financial Period Closing

Before closing:

```text
Open invoices reviewed
Payments reconciled
Outstanding balances calculated
Expenses recorded
Adjustments reviewed
```

Then:

```text
Period → Closed
```

Closed periods become protected.

---

# 60. Reconciliation

The system must eventually support reconciliation between:

```text
Platform Ledger
      ↕
Payment Provider
      ↕
Settlement Account
```

Mismatches must be visible.

Examples:

```text
Paid by provider
but missing in ledger

Ledger marked paid
but provider verification failed
```

Such mismatches must generate reconciliation exceptions.

---

# 61. Financial Exceptions

Recommended:

```text
FinancialException
----------------------------
Id
BuildingId
Type
ReferenceType
ReferenceId
Severity
Status
Description
CreatedAt
ResolvedAt
ResolvedBy
```

Examples:

- Duplicate callback
- Provider mismatch
- Amount mismatch
- Unknown transaction
- Duplicate payment
- Missing settlement
- Reconciliation failure

---

# 62. Security

Financial APIs must enforce:

- Authentication
- Building scope
- Unit scope
- Role permission
- Server-side validation
- Idempotency
- Audit
- Encryption for sensitive data
- No trust in client-provided amounts

The client must never determine the authoritative payable amount.

---

# 63. Critical Anti-Fraud Rule

Never accept:

```text
POST /pay
{
  "amount": 1000
}
```

as the authoritative payment amount.

Instead:

```text
InvoiceId
 ↓
Server loads invoice
 ↓
Server calculates payable balance
 ↓
PaymentIntent created
```

The amount comes from trusted server-side financial data.

---

# 64. Financial Isolation

A manager of Building A must not access:

```text
Building B Ledger
Building B Invoices
Building B Payments
Building B Expenses
```

even if the manager belongs to the same Organization, unless the organization-level role explicitly grants access.

---

# 65. Suggested Core Entities

BM-03:

```text
BuildingFinancialAccount
UnitFinancialAccount
FinancialPeriod
ChargeRule
Charge
ChargeCalculationSnapshot
Invoice
InvoiceLine
PaymentIntent
Payment
LedgerEntry
Expense
Income
FinancialCategory
Adjustment
Refund
CreditBalance
SettlementAccount
FinancialException
Receipt
```

---

# 66. Relationship Overview

```text
Building
   │
   ├── FinancialAccount
   │
   ├── FinancialPeriod
   │      │
   │      ├── ChargeRule
   │      ├── Charge
   │      │     ↓
   │      │   Invoice
   │      │     ↓
   │      │   Payment
   │      │     ↓
   │      │   Ledger
   │      │
   │      └── Expenses
   │
   ├── Units
   │     ↓
   │   UnitLedger
   │
   └── SettlementAccount
```

---

# 67. BM-03 Acceptance Criteria

BM-03 is complete only when:

- [ ] Building financial account exists
- [ ] Unit financial account exists
- [ ] Ledger exists
- [ ] Financial periods exist
- [ ] Charge rules exist
- [ ] Fixed charge works
- [ ] Area-based charge works
- [ ] Fixed + area works
- [ ] Per-person calculation foundation exists
- [ ] Extraordinary charge works
- [ ] Charge calculation snapshot works
- [ ] Invoice exists
- [ ] Invoice lines exist
- [ ] Partial payment works
- [ ] Overpayment works
- [ ] Credit balance works
- [ ] Payment abstraction exists
- [ ] Payment provider transaction is stored
- [ ] Server-side payment verification is enforced
- [ ] Payment callbacks are idempotent
- [ ] Receipt is generated
- [ ] Expense exists
- [ ] Expense approval foundation exists
- [ ] Income exists
- [ ] Financial categories exist
- [ ] Adjustment works
- [ ] Refund foundation works
- [ ] Reversal works
- [ ] Settlement account exists
- [ ] Monthly charge generation is automated
- [ ] Duplicate charge generation is prevented
- [ ] Financial audit works
- [ ] Financial dashboard foundation works
- [ ] Reconciliation exception model exists
- [ ] Financial data is isolated by Building

---

# 68. Definition of Done

BM-03 is **COMPLETE** only when:

1. Monthly charges can be generated automatically.
2. Historical charge calculations are reproducible.
3. Invoices are generated without manual data entry.
4. Users can pay through the payment-provider abstraction.
5. Payment success is verified server-side.
6. Duplicate callbacks cannot create duplicate ledger effects.
7. Ledger balances are deterministic.
8. Partial and overpayments are supported.
9. Expenses can be recorded and controlled.
10. Financial corrections are non-destructive.
11. Closed periods are protected.
12. Financial data is fully building-scoped.
13. Authorization and audit tests pass.
14. BM-03 does not violate BM-00, BM-01, or BM-02.

---

# 69. Explicit Non-Goals

Do not implement in BM-03:

- Direct dependency on AP
- Direct dependency on 724
- Full banking core
- Tax accounting engine
- Payroll
- Corporate accounting
- Provider marketplace
- Maintenance Work Order engine
- Election engine
- AI

Payment providers must be integrated through the abstraction defined here.

---

# 70. BM-03 Architecture Gate

The following rules are mandatory:

```text
Charge ≠ Payment
Invoice ≠ Payment
Payment ≠ Ledger Entry
Expense ≠ Maintenance Work Order
Building ≠ Bank Account
Manager ≠ Financial Owner
```

And:

```text
Client Amount ≠ Trusted Amount
Callback ≠ Verified Payment
Deleted Transaction ≠ Correction
```

---

# 71. Final Principle

> **The manager should configure and supervise the building's financial system, not manually maintain it. The platform must calculate charges, issue invoices, accept verified payments, maintain the ledger, preserve history, and make the building's financial position transparent.**

---

## BM-03 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership

**Next Phase:** BM-04 — Payment Provider Integration & Reconciliation

**Implementation Rule:** No specific payment provider may be hard-coded into the Finance domain. AP/724 and future providers must implement the approved payment abstraction.
