# BM-02 — Owners, Residents, Roles & Building Membership
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-02 establishes the identity, membership, relationship, role, invitation, and authorization foundation for people associated with buildings and units.

BM-02 builds on:

- BM-00 — Product Constitution
- BM-01 — Organization, Building & Unit Foundation

BM-02 must preserve the principle:

> **A person, a building, a unit, an ownership relationship, an occupancy relationship, and a management role are different concepts and must not be collapsed into one entity.**

---

# 2. Scope

BM-02 covers:

- User identity
- Person/profile
- Owner relationship
- Resident relationship
- Tenant relationship
- Unit membership
- Building membership
- Building roles
- Unit roles
- Invitations
- Membership lifecycle
- Role assignment
- Access boundaries
- Ownership/occupancy verification foundation
- Privacy rules for personal information
- Audit requirements

BM-02 does not implement:

- Monthly charge calculation
- Payment gateway
- Full accounting
- Maintenance Work Orders
- Service Provider Network
- Election execution
- AI

Those belong to later phases.

---

# 3. Core Identity Principle

The platform must distinguish:

```text
User
Person
Building
Unit
Ownership
Occupancy
Membership
Role
Management Term
```

These are not interchangeable.

Recommended conceptual model:

```text
User
  │
  ↓
Person/Profile
  │
  ├──────── Ownership ──────── Unit
  │
  ├──────── Occupancy ──────── Unit
  │
  ├──────── UnitMembership ─── Unit
  │
  └──────── BuildingMembership
                              │
                              ↓
                           Building
```

---

# 4. User

`User` represents an authenticated platform identity.

Recommended:

```text
User
----------------------------
Id
Email
Phone
Username
Status
CreatedAt
UpdatedAt
LastLoginAt
```

Authentication credentials must be managed separately from business/domain relationships.

Do not use phone number as the domain identity.

---

# 5. Person / Profile

A person profile represents human/business identity data used by the platform.

Recommended:

```text
Person
----------------------------
Id
UserId
FirstName
LastName
DisplayName
NationalIdReference
ProfileImage
PreferredLanguage
Status
CreatedAt
UpdatedAt
```

Sensitive identity information must be stored and accessed according to security/privacy policy.

---

# 6. User vs Person

The distinction is mandatory.

A User answers:

> Who can authenticate?

A Person answers:

> Who is this individual/business in the domain?

A person may eventually have multiple relationships:

```text
Person A
├── Owner of Unit 101
├── Resident of Unit 101
├── Manager of Building A
└── Member of Building B
```

These relationships must not create duplicate users.

---

# 7. Owner

An owner is not a permanent user role.

Ownership is a **relationship between Person and Unit**.

Recommended:

```text
UnitOwnership
----------------------------
Id
UnitId
PersonId
OwnershipPercentage
StartDate
EndDate
Status
VerificationStatus
CreatedAt
UpdatedAt
```

---

# 8. Multiple Owners

A unit may have multiple owners.

Example:

```text
Unit 101
├── Owner A → 60%
└── Owner B → 40%
```

The system must support ownership percentages.

Total ownership percentage should be validated according to configured rules.

For normal completed ownership records:

```text
Total = 100%
```

unless the building/domain explicitly supports another temporary state.

---

# 9. Ownership History

Ownership is temporal.

Example:

```text
Unit 101

Owner A
1399-1403
      ↓
Owner B
1403-1405
      ↓
Owner C
1405-current
```

Previous ownership must remain historical.

A new owner must not overwrite historical ownership.

---

# 10. Occupancy

Occupancy is independent from ownership.

Examples:

```text
Owner Occupied
Tenant Occupied
Vacant
Authorized Family Occupancy
Other
```

Recommended:

```text
UnitOccupancy
----------------------------
Id
UnitId
PersonId
OccupancyType
StartDate
EndDate
Status
VerificationStatus
```

---

# 11. Owner Occupied

A person may simultaneously be:

```text
Owner
+
Resident
```

This must be represented through two relationships, not one combined role.

---

# 12. Tenant

A tenant is primarily an occupancy relationship.

Tenant status should not automatically imply ownership.

A tenant may have access to:

- Building notices
- Maintenance requests
- Relevant unit information

but should not automatically have access to:

- Owner financial information
- Ownership documents
- Building governance
- Other units
- Management controls

unless explicitly authorized.

---

# 13. Resident

Resident is a functional relationship.

A resident may be:

- Owner
- Tenant
- Family member
- Authorized occupant

The platform should support multiple residents per unit.

---

# 14. Unit Membership

Unit membership controls what a person can do or see within a unit.

Recommended:

```text
UnitMembership
----------------------------
Id
UnitId
UserId
Role
StartDate
EndDate
Status
```

Possible roles:

```text
Owner
Resident
Tenant
AuthorizedOccupant
UnitRepresentative
```

---

# 15. Building Membership

Building membership controls building-level access.

Recommended:

```text
BuildingMembership
----------------------------
Id
BuildingId
UserId
Role
StartDate
EndDate
Status
```

Possible roles:

```text
BuildingManager
AssistantManager
Accountant
BuildingStaff
Security
ReadOnlyAuditor
```

Future roles may be added without changing the core architecture.

---

# 16. Role Is Contextual

A person can have different roles in different buildings.

Example:

```text
User X

Building A → Manager
Building B → Owner
Building C → Resident
```

The system must not use one global `User.Role` field as the sole authorization mechanism.

---

# 17. Global Roles vs Scoped Roles

### Global roles

Examples:

```text
PlatformAdmin
PlatformSupport
```

### Scoped roles

Examples:

```text
BuildingManager
Accountant
Resident
Owner
Tenant
```

Scoped roles must be evaluated with resource context.

---

# 18. Role Assignment

Role assignment must have lifecycle:

```text
Pending
Active
Suspended
Expired
Revoked
```

A revoked role must not grant access.

Historical role assignments should remain auditable.

---

# 19. Manager Role

Manager is a building-scoped role.

Do not implement:

```text
User.IsManager = true
```

as the authoritative model.

Instead:

```text
Building
 ↓
ManagementTerm
 ↓
ManagerUser
```

This allows annual management changes without changing the Building.

---

# 20. Manager Handover Foundation

BM-02 only establishes access behavior.

The complete handover workflow belongs to BM-07.

When a management term ends:

```text
Old Manager
   ↓
Former Manager
```

The old manager must lose active management privileges.

The new manager receives active management privileges after authorization/handover conditions are satisfied.

---

# 21. Access Model

Recommended authorization model:

```text
User
 ↓
Identity
 ↓
Membership
 ↓
Role
 ↓
Resource Scope
 ↓
Permission
```

Example:

```text
User
 → Building A
 → BuildingManager
 → Maintenance
 → Create/Assign/Close
```

---

# 22. Permission Model

Permissions should be granular.

Example:

```text
Building.View
Building.Edit

Unit.View
Unit.Edit

Resident.View
Resident.Manage

Finance.View
Finance.Manage

Maintenance.View
Maintenance.Create
Maintenance.Assign

Governance.View
Governance.Manage

Documents.View
Documents.Manage
```

The exact permission catalog may expand in later phases.

---

# 23. Least Privilege

Default access must be minimal.

Examples:

### Resident

Can:

- View own unit
- View permitted building notices
- Create maintenance request
- View own charges
- Vote where eligible

Cannot:

- View another unit's financial data
- Manage building settings
- Assign providers
- Change other residents

### Manager

Can:

- Manage building operations
- Manage members
- Manage charges
- Manage maintenance
- Manage documents
- Manage notifications

but only within buildings for which the user has active authority.

---

# 24. Privacy Classes

Personal data should be classified.

### Public

- Display name where appropriate
- Provider public profile
- General role

### Building-Scoped

- Resident name
- Unit association
- Building membership

### Private

- Phone
- Email
- Identity information
- Personal address
- Banking data

### Highly Sensitive

- Identity documents
- Verification documents
- Security credentials

API responses must expose only the minimum necessary data.

---

# 25. Phone Number Policy

Phone number is not a public identifier.

It must not be returned by general Building/Unit listing endpoints.

Phone visibility should be controlled by:

```text
Relationship
+
Role
+
Purpose
+
Operational necessity
```

This aligns with BM-00 Service Provider privacy principles.

---

# 26. Email Policy

Email addresses should also not be exposed broadly.

Use:

- Notification services
- Internal messaging
- Authorized profile views

instead of returning raw email addresses to unrelated users.

---

# 27. Invitation System

Invitation is the primary onboarding mechanism for residents and building members.

Recommended:

```text
BuildingInvitation
----------------------------
Id
BuildingId
UnitId
InvitedByUserId
TargetContact
TargetRole
TokenHash
ExpiresAt
AcceptedAt
RevokedAt
Status
CreatedAt
```

Never store invitation tokens in plaintext if avoidable.

Store a secure hash and compare against the supplied token.

---

# 28. Invitation Lifecycle

```text
Created
 ↓
Sent
 ↓
Pending
 ↓
Accepted
 ↓
Membership Active
```

Alternative:

```text
Pending
 ↓
Expired
```

or:

```text
Pending
 ↓
Revoked
```

---

# 29. Invitation Security

Invitation links must:

- Expire
- Be revocable
- Be unpredictable
- Be single-use where appropriate
- Be scoped to Building/Unit
- Not expose unnecessary personal information

The system must not allow an invitation intended for Unit 101 to grant access to Unit 102.

---

# 30. Join Building

A user may request access to a Building.

Possible flow:

```text
Join Request
 ↓
Identity Verification
 ↓
Building / Unit Selection
 ↓
Manager Approval
 ↓
Membership Created
```

A building name alone is insufficient authorization.

---

# 31. Ownership Verification Foundation

Ownership verification may support:

- Manual manager verification
- Document verification
- Future official registry integration
- Secure verification workflow

BM-02 defines the state model but not a full legal verification engine.

Recommended:

```text
Unverified
Pending
Verified
Rejected
Expired
```

---

# 32. Occupancy Verification

Occupancy may use:

- Manager approval
- Invitation
- Owner confirmation
- Supporting documentation

Recommended:

```text
Unverified
Pending
Verified
Rejected
Expired
```

---

# 33. Relationship Conflicts

The system must handle conflicting relationships.

Examples:

- Tenant invitation after lease ended
- Former owner still listed as resident
- Two active occupancy records
- Duplicate owner record
- User invited to wrong unit

The platform must support explicit status and dates rather than silently overwriting relationships.

---

# 34. Temporal Relationship Rule

Any relationship that can change over time must support:

```text
StartDate
EndDate
Status
```

This applies to:

- Ownership
- Occupancy
- Membership
- Roles
- Management
- Invitations

---

# 35. Data Visibility Matrix

Minimum baseline:

| Resource | Platform Admin | Manager | Owner | Resident | Tenant |
|---|---:|---:|---:|---:|---:|
| Own Profile | ✓ | ✓ | ✓ | ✓ | ✓ |
| Own Unit | ✓ | ✓ | ✓ | ✓ | ✓ |
| Other Unit | ✓ | ✓ | Limited | No | No |
| Own Financial Data | ✓ | ✓ | ✓ | Limited | Limited |
| Other Unit Finance | ✓ | ✓ | No | No | No |
| Building Members | ✓ | ✓ | Limited | Limited | Limited |
| Building Settings | ✓ | ✓ | No | No | No |
| Maintenance Requests | ✓ | ✓ | Own/Permitted | Own | Own |
| Governance | ✓ | ✓ | Eligible | Eligible | Configurable |

This matrix is a baseline and must be refined before production.

---

# 36. Building Manager Access

Manager access is limited to active management terms.

When management expires:

```text
Manager Permission
→ Revoked/Expired
```

Historical data may remain visible only according to defined historical-access policy.

The former manager must not retain unrestricted current-building control.

---

# 37. Accountant Access

Accountant is building-scoped.

Accountant should have financial permissions without automatically receiving:

- Governance authority
- Resident-management authority
- Maintenance assignment authority

Permissions must be granular.

---

# 38. Property Management Company

A property management company may manage multiple buildings.

Recommended:

```text
Organization
├── User A
├── User B
└── User C

Buildings
├── Building 1
├── Building 2
└── Building 3
```

Users may have different permissions in each building.

---

# 39. Removing a User

Removing a user must not delete historical relationships.

Instead:

```text
Membership → Revoked
Occupancy → Ended
Ownership → Ended
Role → Expired
```

The user/account may remain for audit and historical purposes.

---

# 40. User Deactivation

Account states:

```text
Active
Pending
Suspended
Deactivated
```

Deactivation must not destroy financial/governance history.

Where legally required, personal data deletion/anonymization must be handled through a separate privacy process without breaking audit integrity.

---

# 41. Self-Service Profile

Users may update non-sensitive profile information.

Sensitive information may require:

- Verification
- Re-authentication
- Administrative approval

Changes must be audited where relevant.

---

# 42. Duplicate Person Handling

The platform should detect possible duplicate persons using appropriate signals.

Examples:

- Verified phone
- Verified email
- Identity reference
- Existing relationship

Automatic merging of persons must not occur without controlled review.

---

# 43. Authorization Rules

Every sensitive operation must verify:

```text
Authenticated User
+
Active Membership/Role
+
Correct Building
+
Correct Unit
+
Permission
+
Resource Ownership
```

Do not trust:

- Client-side role values
- Hidden form fields
- BuildingId supplied by client
- UnitId supplied by client
- UI visibility

as authorization.

---

# 44. IDOR / BOLA Protection

Tests must explicitly verify:

```text
User from Building A
cannot access:
Building B
Unit B-101
Resident B
Finance B
Documents B
Maintenance B
```

even if the user manually changes IDs in:

- URL
- Request body
- Query parameters
- Headers

---

# 45. API Response Minimization

Endpoints must return only required fields.

Bad:

```json
{
  "id": "...",
  "name": "...",
  "phone": "...",
  "email": "...",
  "nationalId": "...",
  "address": "..."
}
```

for a simple resident list.

Preferred:

```json
{
  "id": "...",
  "displayName": "...",
  "role": "Resident",
  "unitNumber": "101"
}
```

Private information must be retrieved through explicitly authorized endpoints.

---

# 46. Audit Requirements

Audit at minimum:

- User creation
- Login/security events
- Profile changes
- Ownership changes
- Occupancy changes
- Membership creation
- Membership revocation
- Role assignment
- Role revocation
- Invitation creation
- Invitation acceptance
- Invitation revocation
- Verification actions
- Manager access changes
- Permission changes

---

# 47. Notification Foundation

BM-02 may define notification triggers without implementing the full notification platform.

Examples:

- Invitation received
- Invitation accepted
- Membership approved
- Membership revoked
- Ownership verification completed
- Occupancy verification completed
- Role changed

Channels may later include:

- In-app
- SMS
- Email
- Push

---

# 48. Localization

User preferences should support:

```text
fa
en
```

The platform must not store translated labels directly inside domain entities.

Use localization resources.

---

# 49. API Boundaries

Suggested endpoints:

```text
/api/users/me
/api/users/me/profile

/api/buildings/{buildingId}/members
/api/buildings/{buildingId}/invitations

/api/units/{unitId}/members
/api/units/{unitId}/owners
/api/units/{unitId}/occupants

/api/memberships/{membershipId}
/api/invitations/{invitationId}
```

Exact API structure may be refined during implementation.

---

# 50. Database Constraints

Minimum constraints:

1. User IDs unique.
2. Unit membership cannot reference another Building's Unit.
3. Ownership must reference valid Unit and Person.
4. Occupancy must reference valid Unit and Person.
5. Building membership must reference valid Building.
6. Role assignments must be scoped.
7. Invitation must be scoped to the correct Building/Unit.
8. EndDate cannot precede StartDate.
9. Active duplicate relationships must be prevented where business rules require uniqueness.
10. Historical records must remain queryable.

---

# 51. Recommended Indexes

Indexes should support:

```text
UserId
BuildingId
UnitId
PersonId
Role
Status
StartDate
EndDate
VerificationStatus
```

Composite indexes should be introduced based on actual query patterns.

Do not over-index before measurement.

---

# 52. Recommended Core Entities

BM-02 should implement or finalize:

```text
User
Person
BuildingMembership
UnitMembership
UnitOwnership
UnitOccupancy
BuildingInvitation
Role
Permission
RolePermission
ManagementTerm Foundation
```

Where BM-01 already defined an entity, BM-02 must extend rather than duplicate it.

---

# 53. Relationship Overview

```text
                         Organization
                              │
                           Building
                     ┌────────┼────────┐
                     │        │        │
                  Membership  Unit   ManagementTerm
                     │        │
                     │     ┌──┴───┐
                     │     │      │
                     │ Ownership Occupancy
                     │     │      │
                     └─────┴──┬───┘
                               │
                            Person
                               │
                              User
```

---

# 54. BM-02 Security Gate

Before completion, verify:

- [ ] No global Manager flag is used as the authoritative authorization model
- [ ] Building-scoped roles are enforced
- [ ] Unit-scoped access is enforced
- [ ] Cross-building access is denied
- [ ] IDOR/BOLA tests pass
- [ ] Private phone/email data is not leaked
- [ ] Sensitive identity information is protected
- [ ] Invitations are secure
- [ ] Membership expiration works
- [ ] Role revocation works
- [ ] Former managers lose active privileges
- [ ] Historical relationships remain intact

---

# 55. BM-02 Acceptance Criteria

BM-02 is complete only when:

- [ ] User identity is separated from domain relationships
- [ ] Person/Profile exists
- [ ] Owner relationship works
- [ ] Multiple ownership works
- [ ] Ownership history works
- [ ] Resident relationship works
- [ ] Tenant relationship works
- [ ] Multiple residents are supported
- [ ] Occupancy history works
- [ ] Building membership works
- [ ] Unit membership works
- [ ] Contextual roles work
- [ ] Permission model exists
- [ ] Invitation workflow works
- [ ] Join-building workflow is secured
- [ ] Ownership verification foundation works
- [ ] Occupancy verification foundation works
- [ ] Manager role is management-term based
- [ ] Membership lifecycle works
- [ ] Privacy classes are enforced
- [ ] API response minimization is implemented
- [ ] Cross-building isolation is tested
- [ ] IDOR/BOLA tests pass
- [ ] Audit logging works
- [ ] Localization foundation works

---

# 56. Definition of Done

BM-02 is **COMPLETE** only when:

1. Identity and relationship models are implemented.
2. Building and Unit membership is implemented.
3. Ownership and occupancy are temporal.
4. Role-based authorization is server-side.
5. Cross-building isolation is verified.
6. Sensitive personal data is protected.
7. Invitation and join workflows are secure.
8. Former members lose active privileges correctly.
9. Historical relationships remain intact.
10. Automated authorization/security tests pass.
11. BM-02 does not violate BM-00 or BM-01.
12. BM-03 can consume the membership model without redesign.

---

# 57. Explicit Non-Goals

Do not implement in BM-02:

- Charge formulas
- Payment gateway
- Ledger
- Maintenance Work Order engine
- Provider marketplace
- Provider ranking
- Election execution
- AI
- IoT
- Full document management

---

# 58. BM-02 Architecture Gate

The following distinctions are mandatory:

```text
User ≠ Person
Person ≠ Owner
Person ≠ Resident
Owner ≠ Resident
Resident ≠ Tenant
Membership ≠ Ownership
Membership ≠ Occupancy
Role ≠ Identity
Manager ≠ Building
```

These distinctions must be reflected in:

- Domain entities
- Database schema
- API contracts
- Authorization
- UI
- Audit trail

---

# 59. Final Principle

> **People change roles and relationships over time. The platform must preserve those relationships as historical, scoped, auditable records rather than overwriting identity or building state.**

---

## BM-02 Status

**Status:** Implementation Baseline

**Depends On:**  
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation

**Next Phase:** BM-03 — Finance, Monthly Charge & Ledger

**Implementation Rule:** No Finance, Payment, Maintenance, Provider, or AI logic should be embedded into BM-02 beyond the identity, membership, and authorization interfaces required by the approved architecture.
