# BM-00 — Foundation & Product Architecture
## Building Management Platform
### Version 1.0 — Baseline

---

## 1. Purpose

BM-00 establishes the product constitution, domain boundaries, architectural principles, security/privacy rules, business model, and MVP boundary for the Building Management Platform.

**BM-00 is a design gate. No production implementation should begin until the BM-00 decisions are reviewed and accepted.**

---

# 2. Product Vision

The product is a **Building Operations Platform**, not merely a building-charge application.

The platform must integrate:

- Building management
- Units
- Owners and residents
- Monthly charges
- Financial ledger
- Online payments
- Maintenance requests
- Routine maintenance
- Service-provider network
- Provider reputation
- Map-based provider matching
- Governance and elections
- Management handover
- Contracts and documents
- Notifications
- Audit history
- Reporting

The core value proposition:

> A building manager should not have to start from zero whenever a building problem occurs. The platform should help identify and match an appropriate service provider while simultaneously managing the building's financial and operational records.

---

# 3. Product Positioning

## 3.1 Product Category

**Building Operations Platform**

## 3.2 Primary Users

- Building Manager
- Property Management Company
- Owner
- Resident
- Tenant
- Accountant
- Service Provider
- Technician
- Platform Administrator

## 3.3 Primary Differentiators

1. Multi-building architecture
2. Building-first permanent identity
3. Automated monthly charge and payment workflow
4. Maintenance/work-order workflow
5. Service Provider Network
6. Reputation Engine
7. Map-based Provider Matching
8. Governance and annual management election
9. Management handover
10. Privacy by Design

---

# 4. Product Constitution

## Rule 01 — Building Is Permanent

A building is a permanent business/domain entity.

Changing the manager must never create a new building.

The building retains:

- Financial history
- Maintenance history
- Documents
- Contracts
- Elections
- Management terms
- Decisions
- Work orders
- Audit history

---

## Rule 02 — Manager Is a Temporary Role

A manager is assigned to a building for a defined management term.

Example:

```text
Building A
├── 1404-1405 → Manager A
├── 1405-1406 → Manager B
└── 1406-1407 → Manager C
```

Manager changes must not affect the identity of the building.

---

## Rule 03 — Governance Must Be First-Class

The platform must support:

- Candidate registration
- Election
- Eligible voters
- Voting rules
- Quorum
- Results
- Management term
- Handover
- Former manager
- Active manager
- Meeting
- Resolution
- Audit trail

---

## Rule 04 — Historical Data Is Never Deleted

Historical financial, operational, governance, and audit records must not be deleted by a new manager.

Corrections must use controlled mechanisms such as:

- Reversal
- Refund
- Adjustment
- Correction record

rather than destructive deletion.

---

# 5. Multi-Building Architecture

The platform must be multi-building from the beginning.

Recommended logical structure:

```text
Platform
│
├── Organization / Property Management Company
│
├── Building A
│   ├── Units
│   ├── Owners
│   ├── Residents
│   ├── Finance
│   ├── Maintenance
│   ├── Documents
│   └── Governance
│
├── Building B
│
└── Building C
```

A user may have different roles in different buildings.

A service provider may serve multiple buildings.

---

# 6. Identity and Access

## Minimum Roles

- PlatformAdmin
- PropertyManager
- BuildingManager
- Accountant
- Owner
- Resident
- Tenant
- ServiceProvider
- Technician

Authorization must be evaluated using:

```text
Role
+
Organization
+
Building
+
Resource
+
Action
```

A user must never gain access to another building merely because they have a valid account.

---

# 7. Building Lifecycle

The building lifecycle is independent from the management lifecycle.

```text
Building Created
      ↓
Building Active
      ↓
Management Term
      ↓
Election
      ↓
New Manager
      ↓
Management Handover
      ↓
New Management Term
```

The building itself remains active unless explicitly decommissioned under a separate business rule.

---

# 8. Management Term

Recommended entity:

```text
ManagementTerm
----------------------------
Id
BuildingId
ManagerId
ElectionId
StartDate
EndDate
Status
HandoverDate
CreatedAt
```

Possible statuses:

- Scheduled
- Active
- Expired
- Terminated
- HandoverPending
- HandoverCompleted

---

# 9. Election & Governance

Election must be a domain module, not a generic survey.

Core concepts:

```text
Election
Candidate
EligibleVoter
VotingRule
Vote
Quorum
ElectionResult
Resolution
ManagementTerm
ManagementHandover
```

Voting rules must be configurable to support building-specific governance requirements.

Possible voting models:

- One vote per unit
- Ownership-share weighted vote
- Configured building rule

The exact legal rule must be configurable and must not be hard-coded into the platform.

---

# 10. Management Handover

When a new manager takes office, the system must support a formal handover.

Handover should cover:

- Financial balance
- Bank/settlement configuration
- Open maintenance requests
- Open work orders
- Active contracts
- Documents
- Equipment/assets
- Outstanding invoices
- Outstanding receivables
- Pending decisions
- Meeting records
- Building notices

Old manager:

```text
Active Manager → Former Manager
```

New manager:

```text
Candidate / Elect → Active Manager
```

Historical access must be controlled by role and policy.

---

# 11. Finance Architecture

The finance module must be **Ledger-oriented**, not merely payment-oriented.

Core concepts:

- Charge
- Invoice
- Payment
- Expense
- Income
- Debit
- Credit
- Balance
- Refund
- Reversal
- Adjustment
- Receipt

Each unit must have a financial account/ledger.

---

# 12. Monthly Charge

The platform must support configurable charge calculation.

Possible models:

- Fixed amount
- Area-based
- Fixed + area
- Per-person
- Consumption-based
- Extraordinary charge
- Custom building formula

A building may define more than one charge component.

Example:

```text
Monthly Charge
├── Fixed Component
├── Area Component
├── Utility Component
└── Extraordinary Component
```

---

# 13. Payment Architecture

Manual payment entry by the building manager must NOT be the primary payment workflow.

Standard flow:

```text
Charge
  ↓
Invoice
  ↓
Pay
  ↓
Payment Provider
  ↓
Callback
  ↓
Server Verification
  ↓
Ledger Entry
  ↓
Invoice Settlement
  ↓
Receipt
```

The system must never consider a payment successful merely because the user returned from the payment page.

Payment must be server-side verified.

---

# 14. Payment Provider Abstraction

The domain must not depend directly on a specific provider.

Use an abstraction such as:

```text
IPaymentProvider
```

Possible implementations:

- AP
- 724
- Other future providers

The provider must be replaceable without changing core Finance/Charge logic.

---

# 15. Settlement Account

Each building may configure a settlement destination according to applicable banking/payment-provider requirements.

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
GatewayProvider
Verified
EffectiveFrom
EffectiveTo
Status
```

When management changes, the settlement account may change without changing the building or its financial history.

Old settlement accounts remain historical records.

---

# 16. Payment Integrity

Confirmed financial transactions must never be hard-deleted.

Corrections use:

- Refund
- Reversal
- Adjustment

Every financial action must have an audit trail.

Recommended audit fields:

```text
Who
What
When
Before
After
Reference
Source
```

---

# 17. Maintenance

Maintenance is a core operational module.

Basic workflow:

```text
New
 ↓
Assigned
 ↓
In Progress
 ↓
Completed
 ↓
Confirmed
 ↓
Closed
```

Emergency maintenance may use a faster workflow.

A Maintenance Request should support:

- Building
- Unit
- Reporter
- Problem
- Category
- Priority
- Description
- Image
- Video
- Provider
- Work Order
- Cost
- Completion evidence
- Confirmation
- Rating

---

# 18. Routine / Preventive Maintenance

The platform must support recurring operational tasks.

Examples:

- Daily
- Weekly
- Monthly
- Quarterly
- Annual

Examples of building routines:

- Elevator service
- Pump inspection
- Fire-system inspection
- Motor-room inspection
- Cleaning
- Water-system checks
- Generator checks
- HVAC service
- Pest control

The system should generate upcoming tasks and notifications automatically.

---

# 19. Service Provider Network

Service providers are a first-class platform entity.

Provider categories may include:

- Electrical
- Plumbing
- HVAC
- Elevator
- Pump
- Motor room
- Fire protection
- CCTV
- Access control
- Automatic doors
- Painting
- Masonry
- Glass
- Cleaning
- Landscaping
- Pest control
- General maintenance
- Other building services

---

# 20. Provider Profile

Public/provider discovery data should include:

- Display name
- Specialty
- Service categories
- Rating
- Completed jobs
- Success rate
- Service area
- Availability
- Verification status
- Response time
- Experience

Private data should be separated:

- Phone
- Private address
- Identity documents
- Banking information
- Private verification documents

---

# 21. Reputation Engine

Provider reputation must be based primarily on real completed work.

Recommended flow:

```text
Work Request
 ↓
Provider Selected
 ↓
Work Order
 ↓
Completed
 ↓
Building/Resident Confirmation
 ↓
Rating
 ↓
Provider Reputation
```

Rating dimensions may include:

- Work quality
- Reliability
- Response time
- Professional behavior
- Price fairness
- Problem resolution

A rating from a provider with hundreds of completed jobs must be statistically more meaningful than a rating from only a few jobs.

---

# 22. Ranking Must Not Be Pay-to-Win

Provider subscription or advertising must not directly buy a higher reputation score.

Ranking may use:

```text
Specialty Match
+
Reputation
+
Successful Jobs
+
Distance
+
Availability
+
Response Time
+
Reliability
+
Recency
```

Paid promotion, if introduced later, must be clearly separated from organic ranking.

---

# 23. Provider Matching

The manager should not be required to manually search through a directory.

Target workflow:

```text
Problem
 ↓
Category / Classification
 ↓
Location
 ↓
Provider Matching
 ↓
Recommended Providers
 ↓
Selection
 ↓
Work Order
```

The platform should recommend suitable providers.

---

# 24. Map Architecture

Map functionality is mandatory for the Service Network.

The map should support:

- Provider service areas
- Approximate provider location
- Building location
- Search radius
- Provider matching
- Availability

Precise private provider addresses must not be publicly exposed.

---

# 25. Privacy by Design

Privacy is required from the backend/domain level, not merely the UI.

Before provider selection:

Do not expose by default:

- Provider private phone
- Provider private address
- Exact provider home location
- Exact building location where unnecessary

Show:

- Approximate service area
- Approximate distance
- Public provider profile
- Specialty
- Reputation
- Availability

After assignment, minimum necessary operational information may be shared.

---

# 26. Contact Exchange

The platform must NOT attempt to prevent legitimate contact between a building manager and a selected provider.

If the manager receives the provider's phone number after assignment and continues communication outside the platform, this is allowed.

The business model must not depend on preventing this behavior.

The platform's value comes from:

- Building management
- Finance
- Charges
- Maintenance
- Governance
- Service discovery
- Provider reputation
- History
- Documents
- Reporting

---

# 27. Communication

The platform may provide:

- In-app messaging
- Work-order chat
- Image sharing
- Video sharing
- Document sharing
- Notifications

Communication is primarily intended to simplify the workflow and protect privacy during discovery.

It is not intended to force all communication to remain inside the platform.

---

# 28. Business Model

Primary revenue:

**Building Subscription**

Recommended launch strategy:

```text
Founding Buildings
        ↓
Free Trial Period
        ↓
Subscription
```

Initial period may be free for several months to build adoption and validate product-market fit.

Possible future revenue:

- Building subscription
- Multi-building/property-management plans
- Provider Pro subscription
- Advanced reporting
- Premium administration
- Enterprise services
- API access

---

# 29. Commission Policy

The core business model must NOT depend on commission from maintenance jobs.

Reason:

- Transactions can move outside the platform.
- Commission creates incentives to bypass the platform.
- The product should create value independently of transaction capture.
- Trust is more important than extracting a percentage from every job.

---

# 30. Provider Network Strategy

The initial network should be built around real building demand.

Recommended strategy:

```text
Acquire Buildings
 ↓
Capture Real Maintenance Requests
 ↓
Recruit Suitable Providers
 ↓
Complete Real Jobs
 ↓
Generate Verified Work History
 ↓
Generate Reputation
 ↓
Improve Matching
 ↓
Attract More Buildings / Providers
```

This reduces the Cold Start problem.

---

# 31. Multi-Tenant / Data Isolation

Every building-specific resource must have explicit ownership/context.

Recommended pattern:

```text
Organization
 ↓
Building
 ↓
Resource
```

Cross-building access must be denied by default.

No user should see another building's:

- Residents
- Financial data
- Maintenance
- Documents
- Contracts
- Votes
- Private provider information

without explicit authorization.

---

# 32. Auditability

Audit logging is mandatory for sensitive actions.

Audit at minimum:

- Login/security events
- Role changes
- Manager changes
- Election actions
- Financial changes
- Payment events
- Charge changes
- Settlement account changes
- Maintenance assignment
- Work-order changes
- Provider verification
- Privacy-sensitive access
- Document changes

---

# 33. AI Strategy

AI is not part of the core MVP dependency.

AI will later support:

- Problem classification
- Provider recommendation
- Cost analysis
- Debt analysis
- Maintenance prediction
- Management assistant
- Financial summaries
- Operational summaries

AI must not replace deterministic financial or authorization rules.

---

# 34. MVP Boundary

## MVP Must Include

1. Organization
2. Building
3. Unit
4. Owner
5. Resident
6. Roles and permissions
7. Management term
8. Basic election/governance model
9. Charge
10. Invoice
11. Payment abstraction
12. Ledger
13. Receipt
14. Maintenance Request
15. Work Order
16. Service Provider
17. Provider profile
18. Provider rating
19. Service area
20. Map
21. Provider matching foundation
22. Notifications
23. Audit trail

## Defer

- IoT
- Smart building control
- Advanced AI
- Full ERP accounting
- Complex marketplace monetization
- Native mobile apps
- Advanced predictive maintenance
- Advanced automation

---

# 35. Suggested Implementation Phases

```text
BM-00 — Foundation & Product Architecture
        ↓
BM-01 — Organization / Building / Unit
        ↓
BM-02 — Owners / Residents / Roles
        ↓
BM-03 — Finance / Charge / Ledger
        ↓
BM-04 — Payment Integration
        ↓
BM-05 — Maintenance / Work Orders
        ↓
BM-06 — Service Provider Network
        ↓
BM-07 — Governance / Election / Handover
        ↓
BM-08 — Contracts / Documents / Communication
        ↓
BM-09 — Reports / Analytics
        ↓
BM-10 — AI / Advanced Services
```

---

# 36. BM-00 Definition of Done

BM-00 is complete only when the following are approved:

- [ ] Product vision approved
- [ ] Product positioning approved
- [ ] Multi-building model approved
- [ ] Building lifecycle approved
- [ ] Management lifecycle approved
- [ ] Election concept approved
- [ ] Management handover approved
- [ ] Role model approved
- [ ] Finance/Ledger model approved
- [ ] Monthly charge model approved
- [ ] Payment architecture approved
- [ ] Settlement account model approved
- [ ] Maintenance workflow approved
- [ ] Routine maintenance concept approved
- [ ] Service Provider model approved
- [ ] Reputation model approved
- [ ] Provider ranking principles approved
- [ ] Map architecture approved
- [ ] Privacy rules approved
- [ ] Contact exchange policy approved
- [ ] Subscription business model approved
- [ ] Commission policy approved
- [ ] Audit requirements approved
- [ ] MVP boundary approved
- [ ] Implementation phases approved

---

# 37. Non-Negotiable Product Rules

1. **Building is permanent.**
2. **Manager is temporary.**
3. **Historical data is preserved.**
4. **Financial transactions are never hard-deleted.**
5. **Payment must be verified server-side.**
6. **Manual payment entry is not the primary workflow.**
7. **The platform is multi-building from day one.**
8. **Service providers are first-class entities.**
9. **Provider reputation is based on real work.**
10. **Provider ranking is not pay-to-win.**
11. **Map is part of provider discovery.**
12. **Privacy is enforced in backend architecture.**
13. **Exact location and private contact data are not exposed by default.**
14. **Legitimate contact after provider selection is allowed.**
15. **The business model does not depend on preventing off-platform contact.**
16. **Primary revenue is subscription-based.**
17. **Commission is not the core revenue model.**
18. **AI must not control deterministic financial/security rules.**
19. **New managers cannot rewrite historical records.**
20. **No production coding should bypass this architecture gate.**

---

# 38. Architectural Principle

The platform must optimize for:

**Trust + Operational Simplicity + Financial Accuracy + Privacy + Network Value**

not:

**Maximum features + Maximum transaction extraction.**

The product succeeds when a building manager can say:

> "I can manage the building here, collect the monthly charges without manual work, run the building's governance, track maintenance, and when something breaks I can quickly find a trusted specialist."

---

## BM-00 Status

**Status:** Architecture Baseline / Pending Implementation

**Next Gate:** BM-01 — Organization, Building & Unit Foundation

**Implementation rule:** Do not begin feature development outside BM-00 constraints without an explicit architecture decision.
