# BM-09 — Reporting, KPI, Budgeting & Management Analytics
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-09 establishes the reporting, KPI, budgeting, forecasting, and management analytics layer of the Building Management Platform.

The objective is to turn building data into actionable management information.

The platform must answer:

- وضعیت مالی ساختمان چگونه است؟
- چه کسانی بدهکارند؟
- شارژ ماهانه چقدر وصول شده؟
- هزینه‌های ساختمان در چه بخش‌هایی مصرف می‌شود؟
- تعمیرات چقدر هزینه داشته‌اند؟
- کدام تجهیزات بیشترین هزینه را ایجاد می‌کنند؟
- کدام سرویسکاران عملکرد بهتری دارند؟
- آیا بودجه ساختمان کافی است؟
- مدیر فعلی چه عملکردی دارد؟
- در مقایسه با دوره‌های قبل چه چیزی تغییر کرده است؟

---

# 2. Core Principle

Reporting must be based on source-of-truth records.

```text
Finance
   ↓
BM-03

Payments
   ↓
BM-04

Maintenance
   ↓
BM-05

Governance
   ↓
BM-06

Documents / Contracts / Assets
   ↓
BM-08

Analytics
   ↓
BM-09
```

BM-09 must not create independent shadow records for financial truth.

---

# 3. Management Dashboard

The building manager should have an answer-first dashboard.

Minimum sections:

```text
Financial
Maintenance
Collections
Outstanding Debt
Budget
Contracts
Assets
Service Providers
Governance
Alerts
```

---

# 4. Executive Snapshot

Example:

```text
Monthly Charge Due        185,000,000
Collected                 161,500,000
Collection Rate              87.3%
Outstanding                 23,500,000

Monthly Expenses          142,000,000
Budget Remaining            38,000,000

Open Maintenance Requests        7
Critical Requests                1
Overdue Work Orders              2

Contracts Expiring <30d          3
Warranties Expiring <30d         2
```

Values must be calculated from source records.

---

# 5. KPI Framework

KPIs should be divided into:

```text
Financial KPIs
Operational KPIs
Maintenance KPIs
Provider KPIs
Governance KPIs
Collection KPIs
Asset KPIs
```

---

# 6. Financial KPIs

Minimum:

```text
Total Charges
Collected Charges
Outstanding Charges
Collection Rate
Total Expenses
Budget
Budget Variance
Cash Position
Outstanding Payables
Outstanding Receivables
```

---

# 7. Collection Rate

Recommended:

```text
Collection Rate =
Collected Amount / Due Amount × 100
```

The calculation must define whether:

- Credits
- Adjustments
- Refunds
- Waivers

are included.

The metric definition must be centralized.

---

# 8. Outstanding Debt

Minimum dimensions:

```text
Building
Unit
Owner
Resident
Month
Age
```

Aging buckets:

```text
0–30 days
31–60 days
61–90 days
91–180 days
180+ days
```

---

# 9. Debt Aging Dashboard

Example:

```text
0–30        8,500,000
31–60       4,200,000
61–90       2,100,000
91–180      3,600,000
180+        5,100,000
```

The dashboard must allow drill-down to authorized units.

---

# 10. Privacy Rule

A resident must not see another unit's:

- Debt
- Payment history
- Income
- Personal financial data

Managers may see building-level financial information according to their authorization.

---

# 11. Monthly Charge KPIs

Track:

```text
Monthly Charge Generated
Monthly Charge Collected
Collection Rate
Average Payment Delay
Number of Debtors
Total Debt
Debt Concentration
```

---

# 12. Expense KPIs

Expenses should be grouped:

```text
Cleaning
Security
Elevator
Electricity
Water
Gas
Repairs
Maintenance
Insurance
Administrative
Common Area
Other
```

Categories must be configurable.

---

# 13. Expense Trend

The platform should show:

```text
Month
Expense
Budget
Variance
```

Example:

```text
Farvardin   110M
Ordibehesht 125M
Khordad     142M
Tir         136M
```

---

# 14. Budget

Recommended:

```text
BuildingBudget
----------------------------
Id
BuildingId
FiscalYear
Status
Currency
CreatedBy
ApprovedBy
CreatedAt
```

Budget lines:

```text
BuildingBudgetLine
----------------------------
Id
BudgetId
CategoryId
PlannedAmount
Notes
```

---

# 15. Budget Lifecycle

```text
Draft
 ↓
Review
 ↓
Approved
 ↓
Active
 ↓
Closed
```

Only authorized users may approve a budget.

---

# 16. Budget vs Actual

Core report:

```text
Category
Budget
Actual
Variance
Variance %
```

Example:

```text
Elevator
Budget: 40M
Actual: 52M
Variance: +12M
```

---

# 17. Variance

Recommended:

```text
Variance = Actual - Budget
```

Positive/negative interpretation must be based on expense/income context.

Avoid ambiguous labels.

---

# 18. Forecast

Future-compatible:

```text
Actual
+
Committed Costs
+
Expected Costs
=
Forecast
```

Forecast must clearly distinguish:

```text
Actual
Committed
Estimated
```

---

# 19. Reserve / Long-Term Fund

The platform should support a reserve concept.

Examples:

```text
Elevator replacement
Roof repair
Generator replacement
Major renovation
```

Reserve planning should not be confused with normal monthly operating expenses.

---

# 20. Capital vs Operating Expense

Support distinction:

```text
OPEX
CAPEX
Reserve
```

Example:

```text
Cleaning → OPEX
Elevator replacement → CAPEX
Major roof replacement → Reserve/CAPEX
```

Configuration must remain flexible.

---

# 21. Maintenance KPIs

Minimum:

```text
Open Requests
Open Work Orders
Completed Work Orders
Overdue Work Orders
Average Response Time
Average Resolution Time
Emergency Jobs
Repeat Failures
Maintenance Cost
```

---

# 22. Response Time

Recommended:

```text
Response Time =
Provider Acceptance - Request Creation
```

The exact definition must be centralized.

---

# 23. Resolution Time

Recommended:

```text
Resolution Time =
Verified Completion - Request Creation
```

Alternative definitions may exist for emergency jobs.

Do not mix definitions across reports.

---

# 24. Maintenance Cost

Track:

```text
Labor
Parts
Transportation
Other
Total
```

Costs should link to WorkOrder and ultimately to BM-03 financial records.

---

# 25. Preventive vs Corrective

Reports should distinguish:

```text
Preventive
Corrective
Emergency
Inspection
Warranty
```

This enables maintenance strategy analysis.

---

# 26. Repeat Failure KPI

A repeat failure occurs when:

```text
Same Asset
+
Same/Related Failure
+
Defined Time Window
```

recurs.

The time window must be configurable.

---

# 27. Asset Cost Analytics

For each major asset:

```text
Age
Maintenance Cost
Failure Count
Downtime
Provider Count
Warranty
Replacement Estimate
```

This supports replacement decisions.

---

# 28. Service Provider KPIs

Minimum:

```text
Completed Jobs
Average Rating
Acceptance Rate
Cancellation Rate
Average Response Time
Average Completion Time
Complaint Rate
Warranty Return Rate
```

---

# 29. Provider Ranking

Ranking should consider:

```text
Performance
+
Relevant Experience
+
Rating
+
Job Volume
+
Availability
+
Distance
```

Do not rank only by rating.

---

# 30. Provider Fairness

The platform must avoid systematically hiding new providers.

A new verified provider may require:

```text
New Provider
+
Verification
+
Relevant Skill
+
Limited Exploration Exposure
```

The exact algorithm should be configurable.

---

# 31. Governance KPIs

Minimum:

```text
Election Participation
Eligible Voters
Votes Cast
Quorum
Management Term
Open Governance Actions
Handover Status
```

---

# 32. Election Participation

Recommended:

```text
Participation Rate =
Participating Voting Weight /
Eligible Voting Weight × 100
```

The metric must use the election's configured voting model.

---

# 33. Handover KPI

Track:

```text
Handover Completion
Open Handover Items
Disputed Items
Average Handover Duration
```

---

# 34. Contract KPIs

Minimum:

```text
Active Contracts
Expiring Contracts
Expired Contracts
Contract Value
Renewal Rate
Contracts Without Renewal Decision
```

---

# 35. Document KPIs

Track:

```text
Total Documents
Expired Documents
Expiring Documents
Missing Required Documents
Recent Uploads
Document Completeness
```

---

# 36. Compliance KPI

Examples:

```text
Valid Certificates %
Expired Certificates
Inspections Due
Inspections Overdue
Insurance Validity
```

---

# 37. Building Health Score

Future-compatible composite score:

```text
Financial Health
+
Maintenance Health
+
Compliance Health
+
Governance Health
+
Asset Health
```

Do not initially hide the underlying metrics behind one score.

The score must be explainable.

---

# 38. Alert Center

BM-09 should aggregate important alerts.

Examples:

```text
High Debt
Budget Overrun
Emergency Maintenance
Overdue Work Order
Contract Expiry
Warranty Expiry
Certificate Expiry
Low Collection Rate
Election Deadline
Handover Pending
```

---

# 39. Alert Severity

Recommended:

```text
Info
Warning
High
Critical
```

Severity must be rule-driven.

---

# 40. Alert Deduplication

The platform must prevent notification storms.

Example:

```text
Contract Expiring
```

should not create hundreds of identical alerts.

Use:

```text
AlertType
Entity
Threshold
Time Window
```

for deduplication.

---

# 41. Thresholds

Managers should be able to configure selected thresholds.

Examples:

```text
Collection Rate < 80%
Debt > X
Budget Variance > 10%
Contract expiry < 30 days
Warranty expiry < 30 days
```

System defaults may exist.

---

# 42. Reporting Period

Reports must support:

```text
Month
Quarter
Year
Fiscal Year
Custom Date Range
```

Building fiscal calendar must be configurable.

---

# 43. Multi-Building Reporting

The platform is intended to support multiple buildings.

Authorized portfolio users may see:

```text
Building A
Building B
Building C
```

and compare:

```text
Collection Rate
Maintenance Cost
Open Requests
Budget Variance
Provider Performance
```

---

# 44. Building Isolation

A manager of Building A must not see Building B.

Cross-building reporting requires explicit portfolio authorization.

---

# 45. Portfolio Dashboard

Future-compatible:

```text
Total Buildings
Total Units
Total Charges
Collection Rate
Total Expenses
Open Maintenance
Critical Issues
Expiring Contracts
```

---

# 46. Unit-Level Analytics

Authorized users may see:

```text
Unit
Monthly Charge
Paid
Outstanding
Payment Delay
```

Never expose this to unauthorized residents.

---

# 47. Owner-Level Analytics

Owner-level reporting must account for ownership history.

If ownership changes:

```text
Historical debt/payment
```

must remain associated with the correct financial responsibility according to BM-03 rules.

---

# 48. Manager Performance

The platform must avoid simplistic manager scoring.

Possible indicators:

```text
Collection
Maintenance Response
Budget Control
Open Issues
Governance Participation
Compliance
```

Manager score must be contextual and never treated as an objective employment/performance judgment without appropriate policy.

---

# 49. Benchmarking

Future-compatible anonymous benchmarking:

```text
Building A
vs
Similar Buildings
```

Possible dimensions:

```text
Cost per Unit
Maintenance Cost per Unit
Collection Rate
Energy Cost
Cleaning Cost
```

Privacy-preserving aggregation is required.

---

# 50. Cost per Unit

Example:

```text
Maintenance Cost per Unit =
Total Maintenance Cost /
Number of Relevant Units
```

The population definition must be explicit.

---

# 51. Cost per Square Meter

Future-compatible:

```text
Cost per m² =
Cost / Total Relevant Area
```

Only use where area data is complete and reliable.

---

# 52. Data Quality

Analytics must expose data quality issues.

Examples:

```text
Missing Unit Area
Missing Expense Category
Unreconciled Payment
Work Order Without Cost
Contract Without Expiry
Asset Without Location
```

Do not silently calculate misleading KPIs.

---

# 53. Metric Definitions

Every important KPI must have a formal definition.

Example:

```text
KPI:
Collection Rate

Definition:
Collected eligible charges /
Eligible charges due

Source:
Financial Ledger

Period:
Building-local period

Exclusions:
Cancelled charges
```

---

# 54. Single Metric Definition

The same KPI must not have different formulas in:

```text
Dashboard
Report
Export
Mobile
API
```

Use centralized metric definitions.

---

# 55. Report Export

Authorized users may export:

```text
PDF
Excel
CSV
```

Exports must respect authorization.

---

# 56. Report Audit

For sensitive reports, log:

```text
Who
Report
Building
Period
Filters
GeneratedAt
```

---

# 57. Scheduled Reports

Future-compatible:

```text
Monthly Financial Report
Monthly Maintenance Report
Quarterly Governance Report
Annual Building Report
```

Delivery:

```text
Dashboard
Email
Download
```

---

# 58. Annual Building Report

Recommended contents:

```text
Management Summary
Income
Charges
Collection
Expenses
Budget vs Actual
Maintenance
Major Repairs
Contracts
Assets
Governance
Next-Year Plan
```

This becomes a key handover artifact.

---

# 59. Manager Monthly Report

Minimum:

```text
Opening Balance
Charges
Collections
Expenses
Closing Balance
Debt
Maintenance
Open Issues
Contracts
Alerts
```

---

# 60. Budget Proposal

Future-compatible workflow:

```text
Historical Data
+
Known Contracts
+
Maintenance Forecast
+
Reserve Needs
+
Expected Inflation/Price Changes
=
Budget Proposal
```

The system should show assumptions.

---

# 61. Budget Approval

Budget approval should integrate with BM-06 governance where the building policy requires resident/owner approval.

Possible:

```text
Draft Budget
 ↓
Manager Review
 ↓
Building Approval / Vote
 ↓
Approved Budget
```

---

# 62. Budget Revision

An approved budget must not be silently overwritten.

Use:

```text
Budget Version
```

Example:

```text
Budget 1405 v1
Budget 1405 v2
```

Each revision must have:

```text
Reason
Author
Date
Approval
```

---

# 63. Forecast vs Budget

Dashboard must distinguish:

```text
Budget
Actual
Committed
Forecast
```

These are not interchangeable.

---

# 64. Financial Reconciliation KPI

BM-04 integration should expose:

```text
Unreconciled Transactions
Failed Payments
Pending Payments
Matched Payments
```

---

# 65. Payment Failure KPI

Track:

```text
Payment Attempts
Successful
Failed
Cancelled
Expired
Pending
```

Payment status must come from BM-04.

---

# 66. Charge Collection Funnel

Recommended:

```text
Charge Generated
      ↓
Payment Initiated
      ↓
Payment Completed
      ↓
Payment Reconciled
      ↓
Ledger Posted
```

The dashboard must distinguish each stage.

---

# 67. Data Freshness

Analytics should indicate freshness where useful.

Example:

```text
Financial data updated: 5 min ago
Maintenance data updated: 2 min ago
```

---

# 68. Analytics Architecture

Recommended:

```text
Transactional Database
        ↓
Validated Query Layer
        ↓
Metric Layer
        ↓
Reporting / Dashboard
```

Avoid uncontrolled SQL formulas scattered across UI pages.

---

# 69. Read Models

For complex dashboards, use optimized read models or materialized views.

Do not degrade transactional performance because of heavy reporting queries.

---

# 70. Periodic Aggregation

For large scale:

```text
Daily Metrics
Monthly Metrics
Annual Metrics
```

may be precomputed.

The source records remain authoritative.

---

# 71. Multi-Tenant Analytics

Tenant/building context must be enforced at query level.

Every analytics query must have an authorization scope.

Do not rely solely on frontend filters.

---

# 72. API Examples

Dashboard:

```text
GET /api/buildings/{buildingId}/dashboard
GET /api/buildings/{buildingId}/kpis
GET /api/buildings/{buildingId}/financial-summary
GET /api/buildings/{buildingId}/maintenance-summary
```

Budget:

```text
POST /api/buildings/{buildingId}/budgets
GET  /api/buildings/{buildingId}/budgets
POST /api/budgets/{id}/submit
POST /api/budgets/{id}/approve
POST /api/budgets/{id}/revisions
```

Reports:

```text
GET /api/buildings/{buildingId}/reports/financial
GET /api/buildings/{buildingId}/reports/maintenance
GET /api/buildings/{buildingId}/reports/annual
```

---

# 73. Security Requirements

Mandatory:

- Authentication
- Role-based authorization
- Building isolation
- Portfolio-level authorization
- Unit-level privacy
- Financial data protection
- Export authorization
- Report audit
- API query scoping
- Protection against IDOR/BOLA

---

# 74. Testing Requirements

### Financial

- Collection rate
- Debt aging
- Budget variance
- Actual vs budget
- Payment reconciliation
- Refunds
- Credits
- Adjustments

### Maintenance

- Response time
- Resolution time
- Cost
- Repeat failure
- Provider performance

### Governance

- Election participation
- Quorum
- Term reporting
- Handover

### Security

- Cross-building data access
- Cross-unit financial access
- Unauthorized exports
- Portfolio isolation

---

# 75. Definition of Done

BM-09 is **COMPLETE** only when:

1. Building management dashboard exists.
2. Financial KPIs exist.
3. Collection KPIs exist.
4. Debt aging exists.
5. Expense analytics exist.
6. Budget entity exists.
7. Budget approval workflow exists.
8. Budget vs actual exists.
9. Forecast foundation exists.
10. Reserve planning foundation exists.
11. Maintenance KPIs exist.
12. Provider KPIs exist.
13. Contract expiry KPIs exist.
14. Asset analytics foundation exists.
15. Governance KPIs exist.
16. Alert center exists.
17. Configurable thresholds exist.
18. Multi-building reporting architecture exists.
19. Building isolation is enforced.
20. Unit-level financial privacy is enforced.
21. Metric definitions are centralized.
22. Data quality indicators exist.
23. Reports can be exported securely.
24. Scheduled reporting architecture is ready.
25. Annual building reporting is supported.
26. Payment reconciliation KPIs integrate with BM-04.
27. No shadow financial ledger is created.
28. Heavy analytics do not compromise transactional performance.
29. Analytics APIs enforce authorization server-side.
30. KPI calculations are test-covered.

---

# 76. Explicit Non-Goals

Do not fully implement in BM-09:

- Full BI platform
- Enterprise data warehouse
- Machine-learning forecasting
- Automated investment management
- Banking
- Payroll
- Legal/accounting certification
- Public benchmarking without privacy controls

---

# 77. BM-09 Architecture Gate

Mandatory distinctions:

```text
KPI ≠ Raw Transaction
Budget ≠ Actual
Actual ≠ Forecast
Committed ≠ Paid
Charge ≠ Payment
Payment ≠ Reconciliation
Report ≠ Source of Truth
Dashboard ≠ Ledger
Manager Score ≠ Objective Performance Judgment
```

The financial source of truth remains BM-03/BM-04.

---

# 78. Final Product Principle

> **A building manager should not need to open ten screens to understand the condition of the building. BM-09 must turn financial, maintenance, governance, asset, contract and payment data into a small number of trustworthy, explainable and actionable management views.**

---

## BM-09 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation
- BM-05 — Building Operations, Maintenance & Service Provider Network
- BM-06 — Governance, Voting, Management Election & Handover
- BM-07 — Communication, Documents, Notifications & Building Knowledge
- BM-08 — Contracts, Documents, Assets & Building Knowledge

**Next Phase:** BM-10 — Platform Administration, Multi-Building SaaS, Subscription & Commercialization

**Implementation Rule:** All KPIs must be source-backed, centrally defined, authorization-aware and reproducible. Analytics must never create a second financial truth.
