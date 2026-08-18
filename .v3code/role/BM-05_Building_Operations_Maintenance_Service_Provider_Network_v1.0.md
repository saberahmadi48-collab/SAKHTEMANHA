# BM-05 — Building Operations, Maintenance & Service Provider Network
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-05 establishes the operational and maintenance backbone of the Building Management Platform.

The central product objective is:

> **The building manager should not spend time searching for technicians, collecting phone numbers, comparing providers manually, or tracking maintenance requests through messages and spreadsheets.**

The platform should connect:

```text
Building
   ↓
Problem / Request
   ↓
Maintenance Workflow
   ↓
Service Provider Network
   ↓
Assignment
   ↓
Execution
   ↓
Verification
   ↓
Rating
   ↓
History
```

BM-05 builds on:

- BM-00 — Product Constitution
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation

---

# 2. Product Vision

The platform is not merely:

> "A building maintenance ticket system."

It is a **building services network**.

Two groups must exist:

### Demand

```text
Buildings
Managers
Owners
Residents
Tenants
```

### Supply

```text
Technicians
Companies
Cleaning services
Electricians
Plumbers
HVAC technicians
Elevator companies
Painters
Pest control
Security services
Other building service providers
```

The platform connects both sides while protecting privacy.

---

# 3. Critical Business Principle

The manager should not need to ask:

> "Do you know an electrician?"

Instead:

```text
Create Request
      ↓
Select Service Category
      ↓
System finds eligible providers
      ↓
Providers are ranked
      ↓
Request is assigned
      ↓
Provider contacts through platform
      ↓
Work completed
      ↓
Verification
      ↓
Rating
      ↓
History
```

---

# 4. Service Provider Network

A Service Provider may be:

- Individual technician
- Small service business
- Registered company
- Maintenance contractor
- Specialized engineering/service company

Recommended entity:

```text
ServiceProvider
----------------------------
Id
ProviderType
BusinessName
DisplayName
Status
VerificationStatus
CreatedAt
UpdatedAt
```

---

# 5. Provider Identity

The provider identity must be separate from:

- Phone number
- Individual technician
- Building
- Work order
- Rating

A provider may later have:

```text
Provider
├── Staff
├── Service Categories
├── Coverage Areas
├── Certifications
├── Ratings
├── Work History
└── Documents
```

---

# 6. Provider Types

Minimum:

```text
Individual
Company
Contractor
Specialist
```

Future types may be added.

---

# 7. Provider Registration

Provider onboarding should support:

```text
Register
 ↓
Profile
 ↓
Select Services
 ↓
Coverage Area
 ↓
Identity/Business Verification
 ↓
Review
 ↓
Active
```

Provider registration does not guarantee ranking or assignment.

---

# 8. Provider Verification

Recommended states:

```text
Unverified
Pending
Verified
Rejected
Suspended
Expired
```

Verification may include:

- Identity
- Business registration
- License
- Certification
- Insurance
- Service credentials

The exact requirements depend on service category.

---

# 9. Service Category

Recommended:

```text
ServiceCategory
----------------------------
Id
ParentId
Name
Description
Status
```

Examples:

```text
Electrical
Plumbing
HVAC
Elevator
Cleaning
Painting
Carpentry
Masonry
Waterproofing
PestControl
Security
Generator
FireProtection
CCTV
AccessControl
Other
```

Categories must be data-driven.

---

# 10. Service Skill

A provider may offer multiple skills.

Recommended:

```text
ProviderService
----------------------------
Id
ProviderId
ServiceCategoryId
SkillLevel
YearsExperience
Status
```

Example:

```text
Provider A
├── Plumbing
├── Pump Repair
└── Water Leak Detection
```

---

# 11. Geographic Coverage

The platform must use location to match providers.

Recommended:

```text
ProviderCoverageArea
----------------------------
Id
ProviderId
City
District
Latitude
Longitude
RadiusKm
Status
```

Future-compatible with:

- Map polygons
- Service zones
- Travel time
- Distance calculation

---

# 12. Map-First Provider Discovery

The provider discovery experience must use a map.

Example:

```text
                MAP
      ● Provider A
             ● Provider B
   ● Provider C

--------------------------------
Filter:
[ Plumbing ]

[ Verified ]
[ Available ]
[ Rating ]
[ Distance ]
```

The exact UI may evolve.

---

# 13. Privacy Rule — Provider Phone Number

The manager does NOT need to see the provider's phone number during discovery.

The platform must NOT expose provider phone numbers by default.

Instead:

```text
Provider Profile
      ↓
[ درخواست سرویس ]
      ↓
Platform Communication
```

The platform controls the relationship.

---

# 14. Why Phone Numbers Must Be Hidden

This protects:

- Provider privacy
- Platform relationship
- Business continuity
- Provider reputation
- Anti-circumvention strategy

It also supports the platform's future subscription business model.

The platform must not depend on users voluntarily paying commission forever.

---

# 15. Platform Communication

Future-compatible communication:

```text
Manager
   ↕
Platform
   ↕
Provider
```

Possible channels:

- In-app messaging
- Masked communication
- Push notifications
- Email
- SMS
- Controlled call routing

Actual phone exposure is optional and policy-controlled.

---

# 16. Service Request

A Service Request represents a problem or need.

Recommended:

```text
ServiceRequest
----------------------------
Id
BuildingId
UnitId nullable
CreatedByUserId
CategoryId
Title
Description
Priority
Urgency
Status
Location
CreatedAt
UpdatedAt
```

---

# 17. Request Scope

A request may belong to:

### Unit

Example:

```text
Apartment 101
Water leak
```

### Common Area

Example:

```text
Building
Elevator malfunction
```

### Building Facility

Example:

```text
Pump Room
Generator
HVAC
```

The model must support all three.

---

# 18. Request Priority

Priority and urgency must be separate concepts.

Priority:

```text
Low
Normal
High
Critical
```

Urgency may describe required response time.

Example:

```text
Critical + Immediate
```

---

# 19. Emergency Request

Emergency examples:

- Major water leak
- Electrical danger
- Elevator entrapment
- Fire protection failure
- Gas-related emergency
- Major flooding

Emergency workflow may bypass normal provider ranking but must remain auditable.

---

# 20. Request Status

Recommended:

```text
Draft
Submitted
Triaged
Searching
Assigned
Accepted
Scheduled
InProgress
Completed
Verified
Closed
Cancelled
Rejected
```

---

# 21. Maintenance Work Order

A ServiceRequest may become a WorkOrder.

```text
ServiceRequest
      ↓
WorkOrder
```

A request is the problem.

A work order is the controlled execution.

---

# 22. Work Order

Recommended:

```text
WorkOrder
----------------------------
Id
BuildingId
UnitId nullable
ServiceRequestId
AssignedProviderId
AssignedByUserId
Priority
Status
ScheduledStart
ScheduledEnd
StartedAt
CompletedAt
VerifiedAt
Description
CreatedAt
UpdatedAt
```

---

# 23. Work Order Lifecycle

Recommended:

```text
Draft
 ↓
Assigned
 ↓
Accepted
 ↓
Scheduled
 ↓
InProgress
 ↓
Completed
 ↓
Verified
 ↓
Closed
```

Alternative:

```text
Rejected
Cancelled
OnHold
```

---

# 24. State Transition Rule

The backend must enforce valid state transitions.

Do not allow:

```text
Completed → Draft
```

through an arbitrary API call.

Every transition must be authorized.

---

# 25. Assignment

Assignment may be:

### Manager selected

```text
Manager
 ↓
Provider
```

### Platform recommended

```text
Request
 ↓
Matching Engine
 ↓
Recommended Providers
```

### Provider marketplace request

```text
Request
 ↓
Eligible Providers
 ↓
Provider accepts
```

The first version may use manager selection while keeping the architecture ready for automated matching.

---

# 26. Provider Ranking

Provider ranking must NOT be based only on star rating.

Recommended scoring factors:

```text
Rating
+
Completed Jobs
+
Recent Performance
+
Response Time
+
Acceptance Rate
+
Cancellation Rate
+
Distance
+
Verification
+
Relevant Skill
+
Price/Cost History
```

The exact formula must be configurable.

---

# 27. Rating

After verified completion, the requester may rate the provider.

Recommended:

```text
ProviderRating
----------------------------
Id
ProviderId
WorkOrderId
BuildingId
UserId
OverallScore
QualityScore
TimelinessScore
ProfessionalismScore
Comment
CreatedAt
```

---

# 28. Rating Eligibility

Only authorized participants may rate.

Example:

```text
WorkOrder Completed
+
WorkOrder Verified
+
Requester = Current Authorized User
```

Then rating becomes available.

A random user must not be able to rate a provider.

---

# 29. Rating Anti-Abuse

The platform must prevent:

- Duplicate ratings
- Self-rating
- Fake completed jobs
- Rating manipulation
- Retaliatory ratings where identifiable
- Provider rating their own company

One work order should normally generate one authoritative requester rating.

---

# 30. Rating Weight

A provider with:

```text
5.0 stars / 2 jobs
```

should not automatically rank above:

```text
4.8 stars / 500 jobs
```

The ranking system should consider sample size.

Possible approach:

```text
Weighted Rating
+
Job Volume
+
Recent Performance
```

---

# 31. Provider Performance

Recommended metrics:

```text
Average Rating
Completed Jobs
Acceptance Rate
Cancellation Rate
Average Response Time
Average Completion Time
Verified Jobs
Complaint Rate
```

Provider ranking should use actual performance.

---

# 32. Provider Availability

Provider should be able to define:

```text
Available
Busy
Unavailable
EmergencyOnly
```

and optionally:

```text
Working Hours
```

The platform must not assign unavailable providers automatically.

---

# 33. Service Area Matching

Matching should consider:

```text
Building Location
+
Provider Coverage
+
Distance
+
Service Category
+
Availability
```

---

# 34. Map Privacy

Provider map markers must NOT reveal:

- Exact home address
- Personal phone
- Private location
- Sensitive identity data

The map may show:

```text
Approximate Service Area
```

until the provider accepts/receives an operational assignment.

---

# 35. Exact Location Disclosure

After assignment, the provider may receive the exact operational location necessary to perform the job.

Example:

```text
Before assignment:
District-level location

After assignment:
Building address
```

For a unit-specific job:

```text
Unit information only after authorized assignment
```

---

# 36. Provider Contact Privacy

Before assignment:

```text
No direct phone number
```

After assignment:

```text
Platform-mediated communication
```

Direct phone exposure should remain policy-controlled.

---

# 37. Anti-Circumvention Principle

The platform should assume:

> Users may attempt to bypass the platform after discovering each other's contact details.

Therefore:

- Phone numbers hidden by default
- Personal emails hidden
- Contact information minimized
- Platform messaging available
- Work history tied to platform
- Receipts/payment workflow inside platform
- Ratings tied to completed work orders
- Provider reputation tied to platform identity

---

# 38. Business Model Implication

BM-05 must NOT require commission as the only monetization mechanism.

This is deliberate.

Initial product:

```text
Free / Promotional Period
```

Future:

```text
Monthly Subscription
+
Optional Premium Services
```

Provider access may eventually be monetized independently.

---

# 39. Free Launch Period

The platform should support configurable:

```text
TrialPeriod
```

for buildings.

Example:

```text
3 months free
```

The exact duration is a business decision and must be configurable.

No hard-coded "free forever" assumption.

---

# 40. Subscription Readiness

BM-05 must expose operational usage metrics that can later support subscription plans.

Examples:

```text
Buildings
Units
Active Users
Service Requests
Completed Work Orders
Provider Searches
Storage
Advanced Reports
```

Billing implementation belongs to a later phase.

---

# 41. Provider Subscription

Future option:

```text
Free Provider
Pro Provider
Verified Provider
Business Provider
```

Do not force this into the initial provider experience.

---

# 42. Service Request Attachments

Requests may include:

- Photos
- Videos
- Documents

Examples:

```text
Broken pipe photo
Elevator error
Electrical panel
Water leak
```

Attachments must be access-controlled.

---

# 43. Before/After Evidence

Work orders should support:

```text
Before
After
```

photos where appropriate.

This improves:

- Verification
- Dispute resolution
- Provider reputation
- Maintenance history

---

# 44. Work Completion

Provider marks:

```text
Completed
```

but the job is not automatically financially/operationally final.

Recommended:

```text
Provider Completed
       ↓
Requester/Manager Verification
       ↓
Verified
       ↓
Closed
```

---

# 45. Completion Evidence

Completion may require:

- Description
- Photos
- Parts used
- Labor
- Time spent
- Provider invoice
- Warranty
- Notes

The required fields depend on service category.

---

# 46. Warranty

Work orders should support:

```text
WarrantyStart
WarrantyEnd
WarrantyTerms
```

This allows:

```text
Repair
 ↓
Failure during warranty
 ↓
Warranty Request
```

instead of creating a completely unrelated job.

---

# 47. Service History

Every completed work order becomes part of building history.

Example:

```text
Building
 ↓
Elevator
 ↓
Repair
 ↓
Provider
 ↓
Date
 ↓
Cost
 ↓
Warranty
 ↓
Rating
```

---

# 48. Asset Foundation

BM-05 should be ready for future Asset Management.

Examples:

```text
Elevator
Pump
Generator
HVAC
Fire Pump
CCTV
Gate
Boiler
```

Conceptually:

```text
Asset
 ↓
Maintenance History
 ↓
Work Orders
```

Detailed asset management may be expanded in BM-06.

---

# 49. Preventive Maintenance Foundation

The platform should be ready for recurring maintenance.

Examples:

```text
Monthly pump inspection
Quarterly generator service
Annual elevator inspection
Fire system inspection
```

The full Preventive Maintenance engine may be implemented later.

---

# 50. Recurring Work

Recommended future model:

```text
MaintenancePlan
----------------------------
Id
BuildingId
AssetId
ServiceCategoryId
Frequency
NextDueDate
ProviderId nullable
Status
```

BM-05 only needs the architectural boundary if full PM is deferred.

---

# 51. Service Request Costs

A work order may generate:

```text
Labor
Parts
Transportation
Other
```

Financial posting must integrate with BM-03.

Do not create an independent shadow ledger.

---

# 52. Cost Approval

Possible flow:

```text
Provider Quote
 ↓
Manager Approval
 ↓
Work
 ↓
Final Cost
 ↓
Financial Expense
```

For emergency jobs:

```text
Emergency
 ↓
Work
 ↓
Post-approval / Documentation
```

The exact threshold rules should be configurable.

---

# 53. Provider Quote

Future-compatible:

```text
ProviderQuote
----------------------------
Id
WorkOrderId
ProviderId
LaborAmount
PartsAmount
OtherAmount
TotalAmount
Currency
ValidityUntil
Status
```

Possible statuses:

```text
Draft
Submitted
Accepted
Rejected
Expired
```

---

# 54. Multiple Quotes

For expensive jobs, the platform should support:

```text
Request
 ↓
Quote A
Quote B
Quote C
 ↓
Manager Comparison
 ↓
Selection
```

This supports transparency.

---

# 55. Quote Selection

Selection should be auditable.

Record:

```text
SelectedProvider
SelectedQuote
SelectedBy
SelectionReason
SelectedAt
```

---

# 56. Emergency Override

Emergency work may bypass normal quote collection.

The platform must still record:

- Reason
- Provider
- Time
- Authorizer
- Cost
- Evidence

---

# 57. Complaint

The platform should support provider complaints.

Recommended:

```text
ProviderComplaint
----------------------------
Id
ProviderId
WorkOrderId
BuildingId
CreatedBy
Category
Description
Severity
Status
Resolution
CreatedAt
ResolvedAt
```

---

# 58. Dispute

A dispute may occur over:

- Price
- Quality
- Completion
- Damage
- Warranty
- No-show
- Misrepresentation

Disputes must be tied to a WorkOrder where possible.

---

# 59. Provider Suspension

Provider may be suspended due to:

- Repeated complaints
- Fraud
- Safety issue
- Fake identity
- Poor performance
- Expired certification

Suspension must prevent new assignments where configured.

Historical work remains.

---

# 60. Provider Removal

Provider removal must not delete:

- Historical jobs
- Ratings
- Financial references
- Audit history

Instead:

```text
Provider → Inactive
```

or:

```text
Provider → Suspended
```

---

# 61. Provider Search

Search filters:

```text
Service
Distance
Rating
Verified
Availability
Price Range
Experience
Emergency Availability
```

Phone number is NOT a search filter.

---

# 62. Provider Profile

Minimum public/authorized profile:

```text
Name
Service Categories
Coverage Area
Verification Badge
Rating
Completed Jobs
Experience
Availability
Reviews
```

Phone/email remain protected.

---

# 63. Provider Map

Map experience:

```text
                    MAP
      ┌─────────────────────────┐
      │      ●                  │
      │             ●           │
      │   ●                     │
      │                 ●       │
      └─────────────────────────┘

Service: Plumbing
Radius: 10 km

[ Verified ]
[ Available ]
[ 4.5+ Rating ]
```

The map must not become a privacy leak.

---

# 64. Service Provider Ranking

Ranking must be explainable.

Example:

```text
Recommended because:
✓ Verified
✓ 4.8 rating
✓ 320 completed jobs
✓ 2.1 km away
✓ Available now
✓ Specialized in this service
```

Avoid an opaque ranking system in the initial release.

---

# 65. Provider Reviews

Reviews should distinguish:

```text
Overall
Quality
Time
Professionalism
```

Text reviews may be moderated.

Do not allow editing historical ratings in a way that destroys auditability.

---

# 66. Moderation

The platform should support moderation for:

- Abusive reviews
- Fake reviews
- Personal data disclosure
- Fraudulent provider claims
- Offensive content

Moderation actions must be audited.

---

# 67. Notification Events

Service notifications:

```text
Request Created
Provider Recommended
Provider Assigned
Provider Accepted
Provider Rejected
Schedule Changed
Work Started
Work Completed
Verification Required
Work Verified
Invoice/Cost Created
Payment Required
Warranty Expiring
Complaint Created
```

---

# 68. Building Manager Dashboard

Minimum:

```text
Open Requests
Emergency Requests
Assigned Jobs
Today's Jobs
Overdue Jobs
Completed Jobs
Provider Performance
Pending Quotes
Pending Verification
Outstanding Maintenance Costs
```

---

# 69. Resident Dashboard

Minimum:

```text
My Requests
Open Issues
Scheduled Visits
Completed Work
Costs
Warranty
Rating
```

A resident must not see unrelated building requests unless explicitly authorized.

---

# 70. Service Provider Dashboard

Minimum:

```text
New Requests
Pending Assignments
Accepted Jobs
Today's Schedule
Completed Jobs
Ratings
Performance
Earnings / Financial References
```

Provider financial features may be expanded later.

---

# 71. Data Ownership

Every operational record must have a clear building path:

```text
ServiceRequest → BuildingId
WorkOrder → BuildingId
ProviderAssignment → WorkOrder → BuildingId
Rating → WorkOrder → BuildingId
Complaint → WorkOrder → BuildingId
```

Cross-building access must be impossible without explicit authorization.

---

# 72. API Security

Every operation must validate:

```text
User
+
Role
+
Building
+
Unit
+
WorkOrder
+
Provider
```

Do not trust:

- Client BuildingId
- Client UnitId
- Client ProviderId
- Client WorkOrder status
- Client cost
- Client rating identity

---

# 73. Provider Privacy API Rule

A provider-list endpoint must NOT return:

```text
Phone
PrivateEmail
HomeAddress
PrivateCoordinates
NationalId
```

unless a separate authorized operation requires it.

---

# 74. Contact Proxy

Future-compatible interface:

```text
ICommunicationProxy
```

Possible methods:

```text
SendMessage()
StartMaskedCall()
SendNotification()
```

This keeps provider contact inside the platform.

---

# 75. Audit

Audit:

- Provider registration
- Verification
- Suspension
- Service changes
- Coverage changes
- Request creation
- Assignment
- Provider acceptance/rejection
- Status changes
- Quote submission
- Quote selection
- Completion
- Verification
- Rating
- Complaint
- Dispute
- Cost approval
- Provider contact events where legally appropriate

---

# 76. Suggested Core Entities

BM-05:

```text
ServiceProvider
ProviderService
ProviderCoverageArea
ServiceCategory
ServiceRequest
WorkOrder
ProviderAssignment
ProviderQuote
ProviderRating
ProviderComplaint
ProviderDispute
ProviderAvailability
MaintenancePlan Foundation
Asset Foundation
ServiceAttachment
Warranty
```

---

# 77. Relationship Overview

```text
Building
   │
   ├── ServiceRequest
   │       ↓
   │    WorkOrder
   │       ↓
   │  ProviderAssignment
   │       ↓
   │  ServiceProvider
   │       │
   │       ├── Services
   │       ├── Coverage
   │       ├── Availability
   │       ├── Ratings
   │       └── History
   │
   └── Asset
           ↓
      Maintenance
```

---

# 78. BM-05 Acceptance Criteria

BM-05 is complete only when:

- [ ] Service provider registration exists
- [ ] Provider verification foundation exists
- [ ] Service categories exist
- [ ] Provider skills exist
- [ ] Provider coverage exists
- [ ] Map-based discovery exists
- [ ] Provider phone numbers are hidden by default
- [ ] Provider privacy is enforced server-side
- [ ] Service Request exists
- [ ] Work Order exists
- [ ] Request-to-WorkOrder conversion works
- [ ] Assignment workflow works
- [ ] Provider acceptance/rejection works
- [ ] Valid state transitions are enforced
- [ ] Provider availability exists
- [ ] Provider ranking foundation exists
- [ ] Rating exists
- [ ] Rating anti-abuse rules exist
- [ ] Work completion verification exists
- [ ] Before/after evidence exists
- [ ] Warranty foundation exists
- [ ] Provider complaint foundation exists
- [ ] Provider suspension exists
- [ ] Quote foundation exists
- [ ] Emergency workflow exists
- [ ] Maintenance history is preserved
- [ ] Finance integration boundary exists
- [ ] Building-level isolation works
- [ ] Unit-level privacy works
- [ ] Audit logging works

---

# 79. Definition of Done

BM-05 is **COMPLETE** only when:

1. A building can create a service request.
2. The request can be matched to eligible providers.
3. Providers can be discovered through a map.
4. Provider phone numbers are not exposed during discovery.
5. A manager can assign a provider without manually exchanging phone numbers.
6. Provider acceptance is recorded.
7. Work execution is tracked through a controlled state machine.
8. Completion can be verified.
9. Provider performance is measurable.
10. Ratings are tied to real completed work.
11. Provider privacy is protected.
12. Maintenance history is preserved.
13. Costs can integrate with BM-03 without creating a shadow ledger.
14. Emergency work is supported.
15. Quote workflow is architecturally supported.
16. Cross-building and cross-unit access controls pass tests.
17. Provider registration and suspension workflows work.
18. Audit trail is complete.
19. The architecture is ready for automated provider matching.

---

# 80. Explicit Non-Goals

Do not fully implement in BM-05:

- Full accounting
- Payment provider internals
- Annual management election
- Advanced AI matching
- Predictive maintenance
- Full IoT integration
- Full asset lifecycle management
- Complex contract management
- Payroll

These may be implemented in later phases.

---

# 81. BM-05 Architecture Gate

Mandatory distinctions:

```text
ServiceRequest ≠ WorkOrder
Provider ≠ Person
Provider ≠ Technician
Provider ≠ Building
ProviderRating ≠ ProviderIdentity
Quote ≠ Invoice
WorkOrder ≠ Expense
Payment ≠ Work Completion
```

And:

```text
Provider Discovery
      ≠
Provider Contact Disclosure
```

The platform must be able to provide discovery and assignment without exposing private contact details.

---

# 82. Final Product Principle

> **The platform's value is not merely storing maintenance requests. Its strategic value is creating a trusted service network in which buildings can find verified providers, providers can build reputation through real completed work, managers can manage maintenance without chasing technicians, and both sides can interact without requiring uncontrolled exchange of private contact information.**

---

## BM-05 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation

**Next Phase:** BM-06 — Governance, Voting, Management Election & Handover

**Implementation Rule:** Service provider discovery must be map-based and privacy-first. Provider phone numbers must not be exposed by default. Maintenance costs must integrate with BM-03 and must never create an independent financial ledger.
