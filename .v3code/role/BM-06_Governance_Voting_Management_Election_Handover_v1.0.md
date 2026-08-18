# BM-06 — Building Governance, Voting, Management Election & Handover
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-06 defines the governance model of the Building Management Platform.

The central principle is:

> **A building is a permanent entity. Management is temporary.**

A manager may change every year, but:

```text
Building
  ↓
continues to exist
```

Only its governance state changes.

The platform must therefore never delete a building because its manager changes.

---

# 2. Governance Model

The building is governed through:

```text
Building
   ↓
Members
   ↓
Voting Rights
   ↓
Election
   ↓
Manager
   ↓
Management Term
   ↓
Handover
```

---

# 3. Building Permanence

A building must have a permanent identity:

```text
BuildingId
```

This identifier must survive:

- Manager change
- Election
- Handover
- Ownership changes
- Resident changes
- Provider changes
- Subscription changes

Historical records remain attached to the same BuildingId.

---

# 4. Manager Is a Role, Not the Building Owner

Critical distinction:

```text
Building ≠ Manager
```

A manager is a person assigned an administrative role for a defined term.

Recommended:

```text
BuildingManagerAssignment
----------------------------
Id
BuildingId
UserId
Role
TermId
StartDate
EndDate
Status
AssignedBy
CreatedAt
```

---

# 5. Management Term

Every management assignment should have a term.

Example:

```text
Term 1405
Manager A
Start: 1405/01/01
End:   1405/12/29
```

Then:

```text
Term 1406
Manager B
Start: 1406/01/01
End:   1406/12/29
```

The building remains unchanged.

---

# 6. Election

Election is a controlled governance process.

Lifecycle:

```text
Election Planned
      ↓
Candidates
      ↓
Voting Open
      ↓
Voting Closed
      ↓
Vote Validation
      ↓
Result
      ↓
Winner Confirmed
      ↓
New Manager
      ↓
Handover
```

---

# 7. Election Entity

Recommended:

```text
ManagementElection
----------------------------
Id
BuildingId
TermId
Status
StartAt
EndAt
EligibilitySnapshotAt
CreatedBy
CreatedAt
ClosedAt
```

---

# 8. Election Status

Recommended:

```text
Draft
Scheduled
CandidateRegistration
VotingOpen
VotingClosed
Counting
ResultPending
Completed
Cancelled
Disputed
```

---

# 9. Candidate

A candidate must be explicitly registered.

Recommended:

```text
ElectionCandidate
----------------------------
Id
ElectionId
UserId
Status
Statement
RegisteredAt
ApprovedAt
```

Possible states:

```text
Pending
Approved
Rejected
Withdrawn
```

---

# 10. Candidate Eligibility

Eligibility rules must be configurable.

Possible rules:

- Owner
- Authorized representative
- Current building member
- No active management suspension
- Minimum membership status

Do not hard-code eligibility assumptions that may differ by building or legal framework.

---

# 11. Voting Rights

Voting rights must be explicitly modeled.

Recommended:

```text
VotingEligibility
----------------------------
Id
ElectionId
UserId
BuildingId
UnitId
VotingWeight
Eligible
Reason
SnapshotAt
```

---

# 12. Critical Rule — Eligibility Snapshot

Voting eligibility must be frozen at a defined point before voting.

Example:

```text
Eligibility Snapshot
        ↓
Voting Opens
        ↓
Membership changes
        ↓
Existing election eligibility remains governed by snapshot
```

This prevents manipulation during an active election.

---

# 13. Voting Weight

The system must support configurable voting models.

Examples:

### One Member = One Vote

```text
Person → 1 vote
```

### One Unit = One Vote

```text
Unit → 1 vote
```

### Ownership Weight

```text
Unit share → voting weight
```

The building's configured governance policy determines the model.

---

# 14. Voting Model

Recommended:

```text
VotingPolicy
----------------------------
Id
BuildingId
ElectionType
VotingMethod
QuorumRule
MajorityRule
VotingWeightRule
SecretBallot
ProxyAllowed
Status
```

---

# 15. Secret Ballot

The platform should support secret voting.

Important distinction:

```text
System knows:
User is eligible
User voted
```

But the election result should not expose:

```text
User → Candidate
```

unless the governing policy explicitly requires a non-secret vote.

---

# 16. Vote Entity

Recommended:

```text
Vote
----------------------------
Id
ElectionId
EligibilityId
CandidateId
CastAt
VoteToken
```

The implementation should separate identity verification from ballot content where secret voting is enabled.

---

# 17. One Vote Rule

An eligible voter may vote only once per election unless the configured voting model explicitly permits another mechanism.

Database/application protection must prevent:

```text
User → Vote
User → Vote again
```

---

# 18. Vote Tampering Protection

Votes must not be editable after casting.

If correction is legally/configurationally required:

```text
Original Vote
    ↓
Correction/Revocation Event
    ↓
New Valid Vote
```

with complete audit trail.

---

# 19. Vote Audit

Audit:

- Election creation
- Eligibility generation
- Candidate registration
- Candidate approval
- Voting opened
- Vote cast
- Vote rejected
- Voting closed
- Counting
- Result
- Confirmation
- Dispute
- Finalization

Do not log secret ballot content together with identifiable voter information.

---

# 20. Quorum

Election may require quorum.

Example:

```text
Eligible Voting Weight = 100
Minimum Quorum = 50
Participating Weight = 62
```

Election satisfies quorum.

The quorum rule must be configurable.

---

# 21. Majority

Possible result rules:

```text
Simple Majority
Absolute Majority
Plurality
Runoff
Weighted Majority
```

The building policy determines the rule.

---

# 22. Tie

Tie handling must be defined.

Possible:

```text
Runoff
Second Round
Re-vote
Configured tie-break procedure
```

Do not automatically select a winner without a defined policy.

---

# 23. Election Result

Recommended:

```text
ElectionResult
----------------------------
Id
ElectionId
WinnerCandidateId
WinningWeight
TotalParticipatingWeight
QuorumSatisfied
MajoritySatisfied
FinalizedAt
FinalizedBy
```

---

# 24. Result Finalization

The result must not immediately change the manager role before validation.

Recommended:

```text
Voting Closed
    ↓
Count
    ↓
Validate
    ↓
Result Pending
    ↓
Authorized Confirmation
    ↓
Manager Assignment
```

---

# 25. New Manager Assignment

After election completion:

```text
Old Manager
    ↓
Term Ends
    ↓
New Manager
    ↓
New Term
```

The old manager's historical access must remain auditable.

---

# 26. Manager Access Transition

Recommended sequence:

```text
Election Completed
        ↓
New Manager Confirmed
        ↓
Handover Started
        ↓
Old Manager = Limited/Handover
        ↓
New Manager = Active
        ↓
Handover Completed
```

Avoid a period where no authorized manager exists.

---

# 27. Handover

Handover is a first-class workflow.

It should transfer operational responsibility without changing historical ownership.

---

# 28. Handover Entity

Recommended:

```text
ManagementHandover
----------------------------
Id
BuildingId
FromManagerId
ToManagerId
FromTermId
ToTermId
Status
StartedAt
CompletedAt
CompletedBy
Notes
```

---

# 29. Handover Status

```text
Pending
InProgress
WaitingForAcceptance
Completed
Disputed
Cancelled
```

---

# 30. Handover Checklist

Recommended:

### Finance

- Current balance
- Outstanding charges
- Outstanding debts
- Bank/settlement account configuration
- Payment provider configuration
- Recent transactions
- Reconciliation exceptions

### Operations

- Open service requests
- Open work orders
- Pending maintenance
- Emergency issues
- Provider assignments

### Documents

- Building documents
- Contracts
- Insurance
- Certificates
- Meeting records
- Policies

### Governance

- Previous elections
- Voting records
- Current term
- Pending governance actions

---

# 31. Handover Item

Recommended:

```text
HandoverItem
----------------------------
Id
HandoverId
Category
ReferenceType
ReferenceId
Description
Status
RequiredAction
CompletedAt
```

---

# 32. Handover Acceptance

The incoming manager must explicitly accept the handover.

Example:

```text
Outgoing Manager
       ↓
Handover Package
       ↓
Incoming Manager Review
       ↓
Accept
```

---

# 33. Handover Dispute

The incoming manager may dispute individual items.

Example:

```text
Handover
 ├── Finance ✓
 ├── Documents ✓
 ├── Maintenance ⚠
 └── Bank Configuration ✓
```

A dispute does not erase the handover history.

---

# 34. Historical Manager Access

After term expiration, the old manager should not retain unrestricted management privileges.

Recommended:

```text
Active Manager
    ↓
Full Management Access
```

After term:

```text
Historical Manager
    ↓
Read-only historical access
```

unless explicitly authorized.

---

# 35. Historical Data Protection

Old manager must never be able to alter:

- Old financial records
- Old votes
- Old work orders
- Old audit logs
- Historical receipts
- Historical contracts

Historical records should be immutable or controlled by explicit correction workflows.

---

# 36. Current Manager

The platform must determine the current manager from the active assignment.

Do NOT use:

```text
Building.ManagerName
```

as the sole source of truth.

Use:

```text
Building
   ↓
Active ManagementAssignment
   ↓
User
```

---

# 37. No Building Deletion on Manager Change

This is a hard architectural rule.

Wrong:

```text
Old Manager leaves
 ↓
Delete Building
 ↓
Create Building for New Manager
```

Correct:

```text
BuildingId remains
       ↓
Old Assignment closes
       ↓
New Assignment opens
```

---

# 38. Membership Changes

Owners and residents may change over time.

The building remains permanent.

Historical membership must be preserved.

Example:

```text
Unit 12
 ├── Owner A — Historical
 └── Owner B — Current
```

---

# 39. Ownership vs Management

These are separate concepts.

```text
Ownership
     ≠
Residency
     ≠
Management
     ≠
Voting Eligibility
```

A person may be:

- Owner
- Resident
- Manager
- Candidate
- Voter

through separate relationships.

---

# 40. Manager Removal

The platform should support configured removal procedures.

Possible:

```text
Resignation
Election Replacement
Removal Vote
Term Expiration
Suspension
```

The action must create an audit record.

---

# 41. Emergency Manager

Future-compatible state:

```text
No Active Manager
        ↓
Emergency/Interim Manager
```

An interim manager may be appointed according to building policy.

---

# 42. Interim Manager

Recommended:

```text
ManagementAssignment
Type:
    Elected
    Interim
    Appointed
```

Interim assignments must have:

- Start
- End
- Authority scope
- Reason
- Authorizer

---

# 43. Delegation

The manager may delegate selected operational tasks.

Example:

```text
Manager
  ↓
Finance Delegate
Maintenance Delegate
Document Delegate
```

Delegation must be permission-based.

It must not transfer ownership of the manager role.

---

# 44. Role-Based Access

Minimum roles:

```text
BuildingManager
AssistantManager
FinanceDelegate
MaintenanceDelegate
BuildingMember
Owner
Resident
ElectionCandidate
Auditor
```

Roles are scoped to a Building.

---

# 45. Building-Level Authorization

Every governance API must validate:

```text
User
+
Building
+
Role
+
Current Term
```

Client-provided BuildingId is never trusted without authorization validation.

---

# 46. Election Privacy

General users may see:

```text
Election status
Candidates
Voting deadline
Result
```

They should not automatically see:

```text
Individual secret votes
```

---

# 47. Candidate Privacy

Candidate profiles should expose only authorized information.

Do not expose:

- Private phone number
- Private address
- Sensitive identity documents

unless required and authorized.

---

# 48. Notifications

Governance notifications:

```text
Election Scheduled
Candidate Registration Open
Candidate Approved
Voting Open
Voting Reminder
Voting Closing Soon
Voting Closed
Result Published
New Manager Confirmed
Handover Started
Handover Requires Action
Handover Completed
```

---

# 49. Election Reminder

The platform may send reminders:

```text
Voting Open
↓
Reminder
↓
Final Reminder
↓
Voting Closed
```

Do not allow notification mechanisms to reveal a user's vote.

---

# 50. Governance Calendar

Building dashboard should show:

```text
Current Manager
Current Term
Term End Date
Next Election
Voting Period
Pending Handover
```

---

# 51. Governance Dashboard

Manager view:

```text
Current Term
Election Status
Pending Decisions
Open Handover Items
Voting Participation
Governance Documents
```

Building member view:

```text
Current Manager
Election
Candidates
Voting Status
Results
Governance History
```

---

# 52. Governance History

The building should maintain:

```text
Management History
----------------------------
Manager
Term
Start
End
Election
Result
Handover
```

This creates institutional memory.

---

# 53. Election History

Historical elections should remain accessible:

```text
Election 1404
Election 1405
Election 1406
```

Each has:

- Candidates
- Participation
- Result
- Finalization
- Audit

Subject to applicable privacy rules.

---

# 54. Dispute

Governance disputes should be modeled.

Recommended:

```text
GovernanceDispute
----------------------------
Id
BuildingId
ElectionId nullable
HandoverId nullable
CreatedBy
Type
Description
Status
Resolution
CreatedAt
ResolvedAt
```

---

# 55. Election Cancellation

An election may be cancelled only through an authorized action.

Reason required:

```text
CancellationReason
CancelledBy
CancelledAt
```

Votes must remain auditable even if the election is cancelled.

---

# 56. Election Reopening

Reopening a closed election must not overwrite the original event.

Create a new election round or controlled revision.

Never silently modify historical voting data.

---

# 57. Governance Audit Trail

Every privileged governance action must include:

```text
Who
What
When
Building
Previous State
New State
Reason
```

---

# 58. Digital Documents

Governance documents may include:

- Meeting minutes
- Election notice
- Candidate statements
- Election result
- Handover report
- Building policies
- Signed resolutions

Documents must be versioned.

---

# 59. Electronic Approval

Future-compatible support:

```text
Digital Acknowledgment
Digital Approval
Electronic Signature
```

Do not assume legal validity of a particular signature mechanism without jurisdiction-specific review.

---

# 60. Financial Continuity

Manager change must NOT reset:

- Monthly charges
- Debts
- Credits
- Payments
- Ledger
- Receipts
- Bank history

The new manager inherits operational responsibility over the same building financial state.

---

# 61. Maintenance Continuity

Manager change must NOT reset:

- Open work orders
- Service history
- Provider relationships
- Warranties
- Asset history
- Pending repairs

---

# 62. Service Provider Continuity

Providers remain associated with historical work.

A new manager can:

```text
View history
Search provider
Assign provider
```

according to permissions.

---

# 63. Subscription Continuity

Manager change must NOT automatically create a new building subscription.

Subscription belongs to:

```text
Building / Organization
```

not to the personal identity of the manager.

---

# 64. Account Recovery

Manager transition must have a recovery process if:

```text
Old Manager unavailable
New Manager elected but cannot access
Election dispute
No active manager
```

The platform must support controlled administrative recovery.

---

# 65. Anti-Fraud

Governance system must protect against:

- Fake voters
- Duplicate accounts
- Duplicate votes
- Unauthorized candidate creation
- Vote manipulation
- Manager self-assignment
- Backdated term changes
- Unauthorized handover alteration

---

# 66. Database Constraints

Recommended constraints:

```text
One active manager assignment per building
```

unless the policy explicitly allows co-management.

```text
One eligibility record per voter per election
```

```text
One valid vote per eligibility
```

```text
One active election per election type/building
```

subject to configured policy.

---

# 67. Concurrency

Election operations must be protected against concurrent requests.

Example:

```text
Voting closes
+
User casts vote simultaneously
```

The backend must resolve the race deterministically.

---

# 68. Time

All election timestamps must use a consistent server-side time source.

Do not trust client device time.

Recommended:

```text
UTC internally
+
Building-local display timezone
```

---

# 69. API Examples

Suggested:

```text
POST /api/buildings/{buildingId}/elections
GET  /api/buildings/{buildingId}/elections
POST /api/elections/{id}/candidates
POST /api/elections/{id}/open
POST /api/elections/{id}/vote
POST /api/elections/{id}/close
POST /api/elections/{id}/finalize
GET  /api/elections/{id}/result
```

Handover:

```text
POST /api/buildings/{buildingId}/handovers
GET  /api/handovers/{id}
POST /api/handovers/{id}/accept
POST /api/handovers/{id}/dispute
POST /api/handovers/{id}/complete
```

---

# 70. Election Security

Mandatory:

- Authentication
- Building authorization
- Eligibility validation
- One-vote enforcement
- CSRF protection where applicable
- Replay protection
- Rate limiting
- Audit
- Secret-ballot separation where configured

---

# 71. Testing Requirements

### Election

- Candidate registration
- Eligibility
- Voting
- Duplicate vote
- Closed election vote
- Quorum
- Majority
- Tie
- Cancellation
- Finalization

### Manager

- Term expiration
- New manager assignment
- Historical access
- Unauthorized manager access
- Delegation
- Interim manager

### Handover

- Start
- Acceptance
- Dispute
- Completion
- Historical records
- Financial continuity
- Maintenance continuity

### Security

- Cross-building access
- Vote manipulation
- IDOR/BOLA
- Unauthorized result modification
- Unauthorized manager assignment

---

# 72. Definition of Done

BM-06 is **COMPLETE** only when:

1. Building identity remains permanent.
2. Manager is modeled as a time-bound role.
3. Management terms exist.
4. Election workflow exists.
5. Candidate registration exists.
6. Voting eligibility exists.
7. Eligibility snapshot exists.
8. Voting model is configurable.
9. One-vote enforcement exists.
10. Secret ballot is supported where configured.
11. Quorum rules are supported.
12. Majority rules are supported.
13. Tie handling is defined.
14. Results are finalized through controlled workflow.
15. New manager assignment is created from the election result.
16. Old manager access is transitioned safely.
17. Handover workflow exists.
18. Handover checklist exists.
19. Handover acceptance exists.
20. Handover dispute exists.
21. Historical management records remain immutable/auditable.
22. Financial continuity is preserved.
23. Maintenance continuity is preserved.
24. Provider continuity is preserved.
25. Subscription continuity is preserved.
26. Governance audit trail exists.
27. Building-level authorization passes security tests.
28. Election concurrency tests pass.
29. Manager change does not require building recreation.
30. No historical governance data is deleted during normal management transition.

---

# 73. Explicit Non-Goals

Do not fully implement in BM-06:

- National/legal election infrastructure
- Government identity verification
- Banking
- Full accounting
- Maintenance execution
- Service provider marketplace
- Advanced AI
- Legal electronic-signature certification

Those require separate architectural phases.

---

# 74. BM-06 Architecture Gate

Mandatory distinctions:

```text
Building ≠ Manager
Manager ≠ Owner
Owner ≠ Resident
Resident ≠ Voter
Voter ≠ Candidate
Candidate ≠ Winner
Election ≠ Management Term
Management Term ≠ Handover
Handover ≠ Building Recreation
```

The permanent object is:

```text
Building
```

The temporary object is:

```text
Management Assignment
```

---

# 75. Final Product Principle

> **A building is an institution, not a user account. Managers come and go; the building, its financial history, maintenance history, governance history, documents, and institutional memory remain.**

The system must therefore make management succession a controlled digital process rather than a destructive account replacement.

---

## BM-06 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation
- BM-05 — Building Operations, Maintenance & Service Provider Network

**Next Phase:** BM-07 — Communication, Documents, Notifications & Building Knowledge

**Implementation Rule:** Never delete or recreate a Building because its manager changes. Management succession must be implemented through time-bound management assignments, elections, controlled access transition, and an auditable handover workflow.
