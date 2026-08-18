# BM-01 — Organization, Building & Unit Foundation
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-01 establishes the foundational domain model for:

- Platform
- Organization
- Building
- Building identity
- Building lifecycle
- Units
- Ownership
- Occupancy
- Building membership
- Management access boundaries

BM-01 must be implemented without violating the BM-00 Product Constitution.

---

# 2. Core Architectural Principle

## Building is the permanent operational identity.

A building must NOT depend on the current manager.

The following relationship is mandatory:

```text
Platform
   ↓
Organization
   ↓
Building
   ↓
Units
```

Management is a relationship assigned to the Building:

```text
Building
   ↓
ManagementTerm
   ↓
Manager
```

A manager leaving the building must never delete or recreate the Building.

---

# 3. Domain Boundaries

BM-01 owns:

- Organization
- Building
- Unit
- Building address
- Building location
- Building status
- Unit status
- Building membership foundation
- Ownership relationship foundation
- Occupancy relationship foundation
- Building identification
- Building settings foundation

BM-01 does NOT own:

- Monthly charge calculation
- Payment processing
- Full accounting
- Maintenance Work Orders
- Provider matching
- Election execution
- Contracts
- AI

Those belong to later phases.

---

# 4. Organization

An Organization represents an entity that may manage one or more buildings.

Examples:

- Individual property manager
- Property management company
- Building management group
- Future enterprise customer

Recommended entity:

```text
Organization
----------------------------
Id
Name
DisplayName
OrganizationType
Status
CreatedAt
UpdatedAt
```

Possible OrganizationType values:

```text
Individual
PropertyManagementCompany
Enterprise
Other
```

---

# 5. Organization Rules

1. An Organization may manage multiple Buildings.
2. A Building may belong to one primary Organization at a time.
3. Organization ownership and Building management are different concepts.
4. A user may belong to multiple Organizations if authorized.
5. Organization membership does not automatically grant access to every Building unless explicitly configured.

---

# 6. Building

Recommended entity:

```text
Building
----------------------------
Id
OrganizationId
BuildingCode
Name
DisplayName
Status
AddressId
LocationId
UnitCount
CreatedAt
UpdatedAt
```

BuildingCode must be stable and unique within the appropriate scope.

Building name may change.

BuildingCode should not change casually.

---

# 7. Building Identity

The Building ID is the permanent technical identity.

The following must NOT change when management changes:

- BuildingId
- Building history
- Unit IDs
- Financial history
- Maintenance history
- Documents
- Governance history

The current manager is never part of the Building's identity.

---

# 8. Building Lifecycle

Recommended statuses:

```text
Draft
Active
Suspended
Inactive
Archived
```

### Draft

Building registration is incomplete.

### Active

Building is operational and available to authorized users.

### Suspended

Temporary operational restriction.

### Inactive

Building is no longer actively managed.

### Archived

Historical state. No normal operational activity.

Archiving must not delete historical data.

---

# 9. Building Creation

Building creation should support:

### Required

- Building name
- City
- Address
- Unit count or unit creation plan
- Initial organization
- Creator

### Optional

- Building code
- Postal code
- Geographic coordinates
- Year built
- Number of floors
- Building type
- Facilities
- Notes

The platform must not require all optional building information at onboarding.

---

# 10. Building Address

Recommended separation:

```text
Building
   ↓
Address
```

Recommended Address entity:

```text
Address
----------------------------
Id
Country
Province
City
District
Street
Alley
BuildingNumber
PostalCode
AddressText
```

The exact address may be private depending on user role.

---

# 11. Building Location

Location should be modeled separately from the textual address.

```text
Building
   ↓
Location
```

Recommended:

```text
Location
----------------------------
Id
Latitude
Longitude
PrecisionLevel
Provider
UpdatedAt
```

PrecisionLevel may be:

```text
Exact
Approximate
Hidden
```

This supports the privacy rules defined in BM-00.

---

# 12. Map Privacy

The building location must not automatically be exposed to every user.

Examples:

### Public/Discovery

```text
Approximate Area
```

### Authorized Service Provider after assignment

```text
Operational Exact Location
```

### Unauthorized Provider

```text
No Exact Location
```

The backend must enforce this.

Do not rely only on frontend hiding.

---

# 13. Unit

A Unit represents a legally/operationally identifiable space within a Building.

Examples:

- Apartment
- Office
- Shop
- Storage
- Parking
- Other configured unit types

Recommended entity:

```text
Unit
----------------------------
Id
BuildingId
UnitNumber
Floor
UnitType
Area
Status
CreatedAt
UpdatedAt
```

---

# 14. Unit Identity

Unit ID is permanent within the Building.

Changing:

- Owner
- Resident
- Tenant
- Manager

must not create a new Unit.

---

# 15. Unit Types

The platform should support configurable types.

Minimum:

```text
Apartment
Commercial
Office
Parking
Storage
Other
```

The type must be data-driven rather than hard-coded wherever possible.

---

# 16. Unit Status

Recommended:

```text
Active
Vacant
UnderConstruction
Inactive
Archived
```

A vacant unit remains part of the Building.

It must not be deleted simply because nobody currently occupies it.

---

# 17. Unit Area

Area must be stored independently from charge calculation.

Recommended:

```text
Area
AreaUnit
```

Example:

```text
120.50 m²
```

The Finance module will later decide how area participates in charge calculation.

BM-01 must not hard-code financial formulas.

---

# 18. Ownership Model

Ownership must be separated from occupancy.

A unit may have:

- One owner
- Multiple owners
- No current owner record during incomplete onboarding

Recommended relationship:

```text
Unit
 ↓
UnitOwnership
 ↓
Person
```

Recommended entity:

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
```

This supports historical ownership.

---

# 19. Ownership History

Ownership must be temporal.

Example:

```text
Unit 101
├── Owner A → 1398-1403
├── Owner B → 1403-1405
└── Owner C → 1405-current
```

Historical ownership must remain available according to authorization rules.

---

# 20. Occupancy Model

Occupancy must be separate from ownership.

A unit may be:

- Owner occupied
- Tenant occupied
- Vacant
- Other authorized occupancy

Recommended entity:

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
```

Possible OccupancyType:

```text
Owner
Tenant
FamilyMember
Other
```

---

# 21. Person Model

The platform should not create separate unrelated user records for:

- Owner
- Resident
- Manager
- Tenant

A central identity/person model should be used.

Recommended conceptual structure:

```text
User
 ↓
Person/Profile
 ↓
Membership / Relationship
 ↓
Building / Unit
```

A person can have multiple roles and relationships.

---

# 22. Building Membership

A user may belong to a Building without owning or occupying a Unit.

Examples:

- Building Manager
- Accountant
- Security personnel
- Maintenance staff
- Property management staff

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

This is foundational for RBAC.

---

# 23. Unit Membership

Where required, access can be scoped to a Unit.

Recommended conceptual model:

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

Examples:

```text
Owner
Resident
Tenant
AuthorizedFamilyMember
```

A user must not automatically see all units in the Building.

---

# 24. Relationship Between Person, User, Unit and Building

Recommended conceptual graph:

```text
                    Organization
                         │
                         │
                      Building
                    /    │     \
                   /     │      \
                Unit   Membership  Management
                 │
          ┌──────┴──────┐
          │             │
      Ownership     Occupancy
          │             │
          └──────┬──────┘
                 │
               Person
                 │
                User
```

This separation prevents future identity and authorization problems.

---

# 25. Manager Assignment

BM-01 must establish the relationship but BM-07 owns the complete Election/Handover workflow.

Conceptually:

```text
Building
   ↓
ManagementTerm
   ↓
Manager/User
```

Do NOT place:

```text
Building.ManagerId
```

as the only representation of management.

A current manager can be derived from the active ManagementTerm.

---

# 26. Management Term Foundation

The minimum foundation:

```text
ManagementTerm
----------------------------
Id
BuildingId
ManagerUserId
StartDate
EndDate
Status
```

Full election fields will be introduced in BM-07.

---

# 27. Building Settings

Building-level configuration should be separated from core identity.

Recommended conceptual entity:

```text
BuildingSettings
----------------------------
BuildingId
Timezone
Currency
Language
ChargeCycle
NotificationPreferences
PrivacySettings
```

The exact finance configuration belongs to later phases.

---

# 28. Time and Localization

The platform should support:

- Persian
- English

and should store timestamps consistently.

Recommended backend principle:

```text
Store timestamps in UTC
Display according to configured/local context
```

Building timezone should be configurable.

---

# 29. Currency

Currency must be configurable at organization/building level.

Do not hard-code:

```text
IRR
```

inside the domain logic.

The initial deployment may use Iranian currency, but architecture should remain extensible.

---

# 30. Data Ownership

Every building-scoped entity must have a deterministic ownership path.

Example:

```text
WorkOrder
 → BuildingId

Charge
 → UnitId
 → BuildingId

Document
 → BuildingId
```

The authorization layer must be able to determine:

> Which Organization and Building does this resource belong to?

without relying on UI input.

---

# 31. Cross-Building Isolation

Cross-building data access must be denied by default.

Example:

```text
User belongs to Building A

Request:
GET /api/buildings/B/units

Result:
403 Forbidden
```

unless the user has explicit authorized access to Building B.

This must be enforced server-side.

---

# 32. Building Onboarding

Recommended onboarding:

```text
Create Account
      ↓
Create / Join Organization
      ↓
Create Building
      ↓
Enter Address
      ↓
Set Location
      ↓
Define Unit Structure
      ↓
Create Units
      ↓
Invite Owners / Residents
      ↓
Assign Initial Manager
      ↓
Building Active
```

The onboarding workflow must support incomplete drafts.

---

# 33. Join Building

A user should be able to join a building through controlled mechanisms.

Possible methods:

- Invitation
- Building code
- Secure invitation link
- Manager approval
- Ownership verification
- Resident verification

Do not allow unrestricted building joining by merely knowing the building name.

---

# 34. Invitation

Recommended conceptual entity:

```text
BuildingInvitation
----------------------------
Id
BuildingId
InvitedByUserId
TargetContact
Role
UnitId
Token
ExpiresAt
AcceptedAt
Status
```

Invitation tokens must:

- Be random
- Expire
- Be single-use where appropriate
- Be revocable
- Never expose sensitive information

---

# 35. Duplicate Building Prevention

The platform must reduce accidental duplicate buildings.

Potential duplicate signals:

- Address
- Postal code
- Building name
- Coordinates
- Unit count
- Registration information

The system may warn:

> A similar building already exists.

But automatic merging must not occur without controlled review.

---

# 36. Unit Numbering

The system should support:

- Automatic numbering
- Manual numbering
- Custom unit identifiers

Example:

```text
101
102
201
202
P-01
S-03
SHOP-01
```

Unit identifiers must be unique within a Building.

---

# 37. Building Code

BuildingCode may be system-generated.

Example:

```text
BLD-000102
```

Users may optionally define a friendly building code.

The internal BuildingId must remain immutable.

---

# 38. Audit Requirements

BM-01 must audit:

- Building creation
- Building status changes
- Address changes
- Location changes
- Unit creation
- Unit modification
- Unit archival
- Ownership changes
- Occupancy changes
- Membership changes
- Invitation creation
- Invitation acceptance
- Role assignment
- Management assignment

---

# 39. Security Requirements

Minimum security requirements:

- Server-side authorization
- Resource-level access checks
- Building-level isolation
- Secure invitation tokens
- No sensitive data in URLs
- No private phone/address exposure through public APIs
- Audit logging for privileged operations
- Validation of BuildingId ownership
- Protection against IDOR/BOLA

---

# 40. API Design Principles

The API must not trust client-provided ownership context.

Bad:

```text
POST /api/units
{
    "buildingId": "..."
}
```

without authorization validation.

Correct conceptual flow:

```text
Authenticated User
      ↓
Authorization Service
      ↓
Building Access Check
      ↓
Domain Operation
```

Every BuildingId/UnitId must be validated against the caller's permissions.

---

# 41. Recommended API Boundaries

Example REST boundaries:

```text
/api/organizations
/api/organizations/{id}/buildings
/api/buildings/{id}
/api/buildings/{id}/units
/api/buildings/{id}/members
/api/buildings/{id}/invitations
/api/units/{id}
/api/units/{id}/owners
/api/units/{id}/occupants
```

Exact API naming may be adjusted during implementation.

---

# 42. Database Principles

Recommended database rules:

1. Primary keys must be stable.
2. Foreign keys must enforce domain relationships.
3. Building-scoped entities must contain or derive BuildingId.
4. Unique constraints must protect unit identity.
5. Historical relationships require StartDate/EndDate or equivalent temporal model.
6. Soft deletion/archival must be used carefully.
7. Financial records must not be hard-deleted.
8. Audit records must be append-oriented.

---

# 43. Suggested Core Entities

BM-01 foundation:

```text
Organization
Building
Address
Location
Unit
Person
User
BuildingMembership
UnitMembership
UnitOwnership
UnitOccupancy
BuildingInvitation
BuildingSettings
ManagementTerm
```

---

# 44. Entity Relationship Overview

```text
Organization
     │
     └───────────────┐
                     ↓
                  Building
               /      │       \
              /       │        \
          Address   Location    ManagementTerm
             │                     │
             │                     ↓
             │                  User
             │
             ↓
            Unit
          /      \
         /        \
Ownership       Occupancy
    │                │
    └───────┬────────┘
            ↓
          Person
            │
            ↓
           User
```

---

# 45. Acceptance Criteria

BM-01 is complete only when:

- [ ] Organization model exists
- [ ] Building model exists
- [ ] Building identity is permanent
- [ ] Building lifecycle is implemented
- [ ] Address model exists
- [ ] Location model exists
- [ ] Unit model exists
- [ ] Unit identity is stable
- [ ] Ownership is separated from occupancy
- [ ] Ownership history is supported
- [ ] Occupancy history is supported
- [ ] Building membership exists
- [ ] Unit membership exists where required
- [ ] ManagementTerm foundation exists
- [ ] Building settings foundation exists
- [ ] Invitation model exists
- [ ] Building onboarding is defined
- [ ] Join-building workflow is secured
- [ ] Cross-building isolation is enforced
- [ ] Server-side authorization is implemented
- [ ] IDOR/BOLA protections are tested
- [ ] Audit requirements are implemented
- [ ] API boundaries are defined
- [ ] Database constraints are defined
- [ ] Duplicate-building protection exists
- [ ] Map/location privacy is enforced
- [ ] Persian/English localization foundation exists
- [ ] UTC/timezone strategy is implemented

---

# 46. Definition of Done

BM-01 is considered **COMPLETE** only when:

1. Domain model is implemented.
2. Database schema and constraints are validated.
3. API endpoints are protected by server-side authorization.
4. Building-to-user access isolation is tested.
5. Ownership and occupancy histories are tested.
6. Building onboarding works end-to-end.
7. Building invitation/join workflow works.
8. Building and Unit CRUD operations are audited.
9. ManagementTerm foundation is ready for BM-07.
10. No BM-01 implementation violates BM-00.

---

# 47. Explicit Non-Goals

Do not implement in BM-01:

- Charge calculation engine
- Payment gateway integration
- Full accounting
- Maintenance workflow
- Service provider marketplace
- Provider rating
- Election engine
- Advanced document management
- AI
- IoT
- Native mobile application

These are separate phases.

---

# 48. BM-01 Architecture Gate

Before moving to BM-02, verify:

```text
Organization
      ↓
Building
      ↓
Unit
      ↓
Ownership / Occupancy
      ↓
Membership / Authorization
```

and:

```text
Building ≠ Manager
Building ≠ User
Building ≠ Payment Account
Building ≠ Management Term
```

These distinctions are mandatory.

---

# 49. BM-01 Final Principle

> **The Building is the permanent root of operational history. People, managers, owners, residents, tenants, accounts, and service relationships may change over time; the Building identity and its historical record must remain intact.**

---

## BM-01 Status

**Status:** Implementation Baseline

**Depends On:** BM-00 — Foundation & Product Architecture

**Next Phase:** BM-02 — Owners, Residents, Roles & Building Membership

**Implementation Rule:** No Finance, Payment, Maintenance, Provider, or AI logic should be embedded into BM-01 beyond the interfaces required by the approved architecture.
