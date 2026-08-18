# BM-08 — Contracts, Documents, Assets & Building Knowledge
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-08 establishes the building's long-term institutional knowledge layer.

The platform must not only manage:

- Residents
- Managers
- Charges
- Payments
- Maintenance
- Service providers
- Elections
- Notifications

It must also preserve the building's:

- Documents
- Contracts
- Assets
- Warranties
- Certificates
- Service history
- Governance records
- Operational knowledge

The core principle is:

> **The building must remember, even when people change.**

---

# 2. Building Knowledge Model

The knowledge architecture is:

```text
Building
   │
   ├── Documents
   ├── Contracts
   ├── Assets
   ├── Warranties
   ├── Certificates
   ├── Maintenance History
   ├── Governance History
   ├── Financial References
   └── Operational Knowledge
```

---

# 3. Document Management

The platform must support controlled document management.

Recommended entity:

```text
BuildingDocument
----------------------------
Id
BuildingId
DocumentTypeId
Title
Description
DocumentNumber
IssueDate
ExpiryDate
Status
Confidentiality
CreatedBy
CreatedAt
UpdatedAt
```

---

# 4. Document Categories

Minimum categories:

```text
Building Deed / Ownership
Meeting Minutes
Election Documents
Management Documents
Contracts
Invoices
Receipts
Insurance
Certificates
Technical Documents
Maintenance Documents
Equipment Manuals
Warranties
Legal Documents
Safety Documents
Policies
Other
```

Categories must be configurable.

---

# 5. Document Versioning

A document must not simply be overwritten.

Recommended:

```text
Document
   ↓
Revision 1
Revision 2
Revision 3
```

Each revision preserves:

- Version
- Uploaded by
- Upload date
- Change description
- File reference
- Status

---

# 6. Document Status

Recommended:

```text
Draft
Active
Expired
Superseded
Archived
Cancelled
```

---

# 7. Document Revision Rule

A new file replacing an old document must create a new revision.

Do not silently replace the previous file.

---

# 8. Document Numbering

System-generated numbering may be provided.

Example:

```text
BLD-1405-CON-0001
BLD-1405-MNT-0007
```

Manual document numbers must also be supported.

---

# 9. Expiry Management

Documents with expiration dates must support alerts.

Examples:

```text
Insurance
Elevator Certificate
Fire Inspection
Contract
Warranty
License
```

Notification schedule:

```text
90 days
30 days
7 days
Expired
```

The schedule must be configurable.

---

# 10. Document Access Control

Documents may contain sensitive information.

Access levels:

```text
Public-to-Building
Members
Managers
Finance
Maintenance
Governance
Restricted
```

The exact authorization must be role-based.

---

# 11. Personal Data Protection

Documents must not expose unnecessary personal information.

Examples:

- National IDs
- Bank details
- Personal addresses
- Private phone numbers
- Private contracts

Access must be restricted.

---

# 12. Document Download Audit

For sensitive documents, record:

```text
Who
What
When
Building
Document
Action
```

---

# 13. Document Search

Users should be able to search by:

```text
Title
Document Number
Category
Date
Expiry
Asset
Contract
Provider
Manager
Tags
```

---

# 14. OCR / Text Extraction Readiness

The architecture should support future OCR.

Pipeline:

```text
Upload
 ↓
File Validation
 ↓
OCR
 ↓
Text Extraction
 ↓
Indexing
 ↓
Search
```

Do not make OCR mandatory for every document in the first release.

---

# 15. AI Knowledge Readiness

Future-compatible:

```text
Building Documents
       ↓
Text Extraction
       ↓
Knowledge Index
       ↓
AI Assistant
```

Possible questions:

```text
When does the elevator contract expire?
Who maintains the generator?
What was the last repair cost?
When is the next fire inspection?
```

AI answers must always reference the underlying source documents/records.

---

# 16. Contract Management

Contracts are first-class business objects.

Recommended:

```text
Contract
----------------------------
Id
BuildingId
ContractNumber
Title
ContractType
ProviderId nullable
StartDate
EndDate
RenewalType
Status
TotalValue
PaymentTerms
Description
CreatedAt
UpdatedAt
```

---

# 17. Contract Types

Examples:

```text
Elevator
Cleaning
Security
HVAC
Fire Protection
Pest Control
Generator
Insurance
Waste Management
Landscaping
Maintenance
Other
```

---

# 18. Contract Lifecycle

```text
Draft
 ↓
Review
 ↓
Approved
 ↓
Active
 ↓
Expiring
 ↓
Renewed / Expired / Terminated
```

---

# 19. Contract Renewal

The platform should support:

```text
Manual Renewal
Automatic Renewal
No Renewal
```

Renewal dates must generate reminders.

---

# 20. Contract Alert

Example:

```text
Contract expires in 30 days
```

Manager dashboard:

```text
Contracts
├── Active: 12
├── Expiring < 30 days: 2
└── Expired: 1
```

---

# 21. Contract Financial Link

A contract may reference:

- Payment schedule
- Invoice
- Budget
- Work order
- Provider

But the contract must not create a duplicate financial ledger.

BM-03 remains the financial source of truth.

---

# 22. Contract Provider Link

A contract may link to:

```text
ServiceProvider
```

Historical provider relationships must remain intact even after provider deactivation.

---

# 23. Contract Documents

A contract may contain:

```text
Main Contract
Annexes
Amendments
Price Lists
Technical Specifications
Insurance
Certificates
Correspondence
```

All revisions must be preserved.

---

# 24. Contract Amendment

Do not overwrite a signed contract.

Use:

```text
Contract
   ↓
Amendment
```

Recommended:

```text
ContractAmendment
----------------------------
Id
ContractId
Number
EffectiveDate
Description
DocumentId
CreatedAt
```

---

# 25. Asset Management Foundation

BM-08 establishes the permanent asset register.

Recommended:

```text
Asset
----------------------------
Id
BuildingId
AssetCode
Name
Category
Location
Manufacturer
Model
SerialNumber
InstallationDate
Status
Criticality
WarrantyEnd
CreatedAt
UpdatedAt
```

---

# 26. Asset Categories

Examples:

```text
Elevator
Pump
Generator
HVAC
Fire Pump
Fire Alarm
CCTV
Gate
Barrier
Boiler
Water Tank
Electrical Panel
Lighting System
Roof Equipment
Other
```

---

# 27. Asset Hierarchy

Assets may have parent-child relationships.

Example:

```text
HVAC System
   ├── Chiller
   ├── Pump
   └── Control Panel
```

Recommended:

```text
ParentAssetId
```

---

# 28. Functional Location

Assets may be associated with locations.

Examples:

```text
Basement
Roof
Mechanical Room
Electrical Room
Lobby
Parking
Unit
Common Area
```

---

# 29. Asset Status

Recommended:

```text
Planned
Active
UnderMaintenance
OutOfService
Retired
Disposed
```

---

# 30. Asset Criticality

Recommended:

```text
Low
Medium
High
Critical
```

Criticality may affect:

- Maintenance priority
- Notification
- Provider matching
- Preventive maintenance
- Emergency response

---

# 31. Asset Identification

Asset code must be unique within a building.

Example:

```text
BLD01-ELV-001
BLD01-PMP-003
BLD01-GEN-001
```

---

# 32. Asset Documents

Every asset may have:

```text
Manual
Datasheet
Certificate
Warranty
Inspection
Repair Record
Photo
Contract
```

---

# 33. Asset Maintenance History

Asset history should aggregate:

```text
WorkOrders
ServiceRequests
Inspections
Repairs
Parts
Costs
Providers
Warranties
```

Example:

```text
Generator
   ↓
15 Work Orders
   ↓
3 Providers
   ↓
5 Years
   ↓
Total Cost
```

---

# 34. Warranty

Warranty is a first-class object.

Recommended:

```text
Warranty
----------------------------
Id
AssetId
ProviderId
ContractId nullable
StartDate
EndDate
Terms
Status
```

---

# 35. Warranty Request

If an asset fails under warranty:

```text
Failure
 ↓
Warranty Check
 ↓
Valid?
 ↓
Warranty Service Request
```

The platform should prevent unnecessary paid maintenance where a valid warranty exists.

---

# 36. Asset Cost History

Asset cost should be derived from financial records and work orders.

Do not manually maintain an independent lifetime-cost number without traceability.

---

# 37. Asset Replacement Planning

Future-compatible:

```text
Asset
 ↓
Age
 ↓
Maintenance Cost
 ↓
Failure Rate
 ↓
Replacement Recommendation
```

Advanced replacement analytics may be implemented later.

---

# 38. Inspection Records

Assets may have inspections.

Recommended:

```text
Inspection
----------------------------
Id
AssetId
BuildingId
Inspector
InspectionDate
Result
NextDueDate
Notes
DocumentId
```

---

# 39. Inspection Status

```text
Scheduled
Completed
Passed
Failed
RequiresAction
Expired
```

---

# 40. Compliance Documents

Examples:

```text
Elevator Inspection
Fire Safety Certificate
Electrical Inspection
Insurance
Gas Certificate
Generator Inspection
```

The platform must support expiry and renewal tracking.

---

# 41. Building Policies

The platform may store operational policies:

```text
Pet Policy
Parking Policy
Renovation Policy
Noise Policy
Waste Policy
Emergency Policy
Common Area Policy
```

Policies must be versioned.

---

# 42. Knowledge Tags

Documents, assets, contracts and records may have tags.

Examples:

```text
#elevator
#fire
#generator
#insurance
#parking
#maintenance
#emergency
```

Tags improve search and future AI retrieval.

---

# 43. Building Knowledge Search

Search should eventually combine:

```text
Documents
Contracts
Assets
Work Orders
Service Requests
Governance
Financial References
```

Example:

```text
"آخرین تعمیر آسانسور چه زمانی بود؟"
```

Potential sources:

```text
Work Order
Invoice
Contract
Maintenance Document
```

---

# 44. Source-of-Truth Rule

The knowledge layer must not become a second source of truth.

Examples:

```text
Payment
→ BM-03

Work Order
→ BM-05

Election
→ BM-06

Document
→ BM-08
```

The knowledge index references these sources.

---

# 45. AI Answer Rule

If AI is introduced:

```text
Question
 ↓
Retrieve source records
 ↓
Generate answer
 ↓
Show citations/references
```

AI must not invent building facts.

---

# 46. Building Timeline

Future dashboard capability:

```text
2022 — Elevator Installed
2023 — Contract Renewed
2024 — Major Repair
2025 — New Manager
2025 — Pump Replacement
2026 — Insurance Renewed
```

This creates institutional memory.

---

# 47. Operational Timeline

The platform should eventually support a unified timeline:

```text
Governance
Finance
Maintenance
Contracts
Documents
Assets
```

All events remain linked to the BuildingId.

---

# 48. Document Storage Architecture

Recommended:

```text
Application Database
      ↓
Metadata
      ↓
Object/File Storage
```

Do not store large files directly inside relational tables unless explicitly justified.

---

# 49. File Security

Uploaded files must be:

- Validated
- Virus/malware scanned where available
- Access controlled
- Stored outside public web root
- Served through authorized endpoints
- Logged where required

Never expose storage paths directly.

---

# 50. File Type Validation

Do not trust only file extension.

Validate:

```text
MIME
File Signature
Size
Extension
```

Define allowed file types.

---

# 51. File Size

File-size limits must be configurable.

Example:

```text
Document
Photo
Video
```

may have different limits.

---

# 52. Storage Lifecycle

Files may be:

```text
Active
Archived
DeletedPendingRetention
Deleted
```

Deletion must respect legal/financial retention requirements.

---

# 53. Soft Delete

Critical records should use controlled deactivation rather than destructive deletion.

Example:

```text
Document → Archived
Contract → Terminated
Asset → Retired
```

---

# 54. Audit

Audit:

- Upload
- Replace/revision
- Download
- Archive
- Restore
- Delete request
- Contract approval
- Contract amendment
- Asset creation
- Asset modification
- Warranty changes
- Inspection result
- Knowledge indexing

---

# 55. Access Model

Example:

### Resident

Can view:

- Building policies
- Authorized public documents
- Relevant maintenance information

### Manager

Can view/manage:

- Contracts
- Documents
- Assets
- Maintenance records
- Compliance

### Finance

Can view:

- Financial contracts
- Payment-related documents

### Maintenance

Can view:

- Technical documents
- Assets
- Manuals
- Work orders

Sensitive documents remain restricted.

---

# 56. Manager Change Continuity

When manager changes:

```text
Documents remain
Contracts remain
Assets remain
Warranties remain
History remains
```

Only access rights change.

This is a critical requirement from BM-06.

---

# 57. Provider Change Continuity

If a provider is replaced:

```text
Old Provider
   ↓
Historical Contract
   ↓
Historical Work Orders
```

remain accessible.

The new provider does not inherit old provider identity/history.

---

# 58. Contract Conflict Detection

Future-compatible validation:

```text
Two active contracts
+
Same service
+
Overlapping period
```

should generate a warning.

Example:

```text
Two active elevator maintenance contracts
```

---

# 59. Expiry Dashboard

Minimum dashboard:

```text
Documents Expiring
Contracts Expiring
Warranties Expiring
Certificates Expiring
Inspections Due
```

---

# 60. Building Knowledge Dashboard

Recommended:

```text
Documents: 182
Contracts: 14
Assets: 63
Warranties: 21
Certificates: 17
Expiring Soon: 5
```

---

# 61. Search Permissions

Search results must be filtered by authorization before display.

Never:

```text
Search all documents
 ↓
Filter only in UI
```

Correct:

```text
User Authorization
 ↓
Authorized Search Scope
 ↓
Results
```

---

# 62. API Examples

Documents:

```text
POST /api/buildings/{buildingId}/documents
GET  /api/buildings/{buildingId}/documents
GET  /api/documents/{id}
POST /api/documents/{id}/revisions
POST /api/documents/{id}/archive
```

Contracts:

```text
POST /api/buildings/{buildingId}/contracts
GET  /api/buildings/{buildingId}/contracts
POST /api/contracts/{id}/amendments
POST /api/contracts/{id}/renew
```

Assets:

```text
POST /api/buildings/{buildingId}/assets
GET  /api/buildings/{buildingId}/assets
GET  /api/assets/{id}
POST /api/assets/{id}/inspections
GET  /api/assets/{id}/history
```

---

# 63. Security Requirements

Mandatory:

- Authentication
- Building authorization
- Role-based access
- File access authorization
- Malware validation
- Secure file delivery
- Audit
- No public file URLs for restricted documents
- Protection against path traversal
- Protection against insecure direct object references
- Rate limiting where appropriate

---

# 64. Testing Requirements

### Documents

- Upload
- Revision
- Archive
- Restore
- Expiry
- Access control
- Unauthorized download

### Contracts

- Create
- Amend
- Renew
- Expire
- Provider relationship

### Assets

- Create
- Hierarchy
- Location
- Criticality
- Maintenance history
- Warranty
- Inspection

### Security

- Cross-building access
- Unauthorized document access
- IDOR/BOLA
- File upload abuse
- Malicious file
- Path traversal

---

# 65. Definition of Done

BM-08 is **COMPLETE** only when:

1. Building document repository exists.
2. Document categories exist.
3. Document revision/versioning exists.
4. Document expiry tracking exists.
5. Document access control exists.
6. Sensitive document access is audited.
7. Contract management foundation exists.
8. Contract renewal tracking exists.
9. Contract amendments exist.
10. Provider-contract relationships exist.
11. Asset register exists.
12. Asset hierarchy exists.
13. Asset location exists.
14. Asset criticality exists.
15. Asset maintenance history is linked.
16. Warranty management exists.
17. Inspection records exist.
18. Compliance expiry tracking exists.
19. Building policies can be versioned.
20. Search is authorization-aware.
21. File storage is private and controlled.
22. Historical records survive manager changes.
23. Audit trail exists.
24. Architecture is ready for AI knowledge retrieval.
25. No duplicate source-of-truth ledger is introduced.

---

# 66. Explicit Non-Goals

Do not fully implement in BM-08:

- General-purpose enterprise DMS
- Full ERP
- Full accounting
- Advanced AI agent
- Predictive maintenance
- IoT platform
- Legal document certification
- Government document verification

These require separate phases or integrations.

---

# 67. BM-08 Architecture Gate

Mandatory distinctions:

```text
Document ≠ Contract
Contract ≠ Invoice
Asset ≠ Work Order
Warranty ≠ Contract
Inspection ≠ Work Order
Knowledge Index ≠ Source Record
File ≠ Document Metadata
Building ≠ Manager
```

The building remains the permanent root.

---

# 68. Final Product Principle

> **The platform must become the institutional memory of the building. When a manager changes, the building should not have to start over. Its contracts, documents, equipment, warranties, inspections, maintenance history and governance records must remain connected, searchable and auditable.**

---

## BM-08 Status

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

**Next Phase:** BM-09 — Reporting, KPI, Budgeting & Management Analytics

**Implementation Rule:** The building is the permanent root of institutional knowledge. Documents, contracts, assets, warranties, inspections and history must survive management changes and remain authorization-controlled, versioned and auditable.
