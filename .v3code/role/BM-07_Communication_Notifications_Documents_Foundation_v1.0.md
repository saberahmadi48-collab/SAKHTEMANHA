# BM-07 — Communication, Notifications & Document Foundation
## Building Management Platform
### Version 1.0 — Architecture & Implementation Baseline

---

## 1. Purpose

BM-07 establishes the communication, notification, and foundational document layer of the Building Management Platform.

The central objective is:

> **People associated with a building must be able to receive reliable, timely, and privacy-respecting information, communicate about operational matters, and access the documents they are authorized to see — without relying on external messaging apps as the primary channel.**

BM-07 builds on:

- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation
- BM-05 — Building Operations, Maintenance & Service Provider Network
- BM-06 — Governance, Voting, Management Election & Handover

BM-07 prepares the ground for BM-08 (Contracts, Documents, Assets & Building Knowledge) by providing the core notification engine, messaging foundation, and basic document storage/access model.

---

# 2. Scope

BM-07 owns:

- Notification engine and delivery channels
- Notification preferences and templates
- In-app messaging foundation
- Work-order and service-request communication
- Building announcements / notices
- Document storage foundation
- Document access control foundation
- Document versioning foundation
- File upload and secure delivery
- Communication audit trail
- Privacy rules for messaging and notifications

BM-07 does **not** own:

- Full contract lifecycle (BM-08)
- Asset register and hierarchy (BM-08)
- Advanced knowledge search / OCR / AI retrieval (BM-08 / later)
- Election-specific ballot content (BM-06)
- Payment receipt generation internals (BM-03 / BM-04)
- Provider ranking engine (BM-05)

---

# 3. Core Architectural Principles

1. **Building is the permanent root**  
   All communications, notifications, and documents are scoped to a Building (and where relevant to a Unit or WorkOrder).

2. **Communication is not the product**  
   Messaging exists to support operations (maintenance, finance, governance). The platform must not depend on forcing all conversation inside the app.

3. **Privacy by default**  
   Contact details (phone, email) are never exposed through general listing or discovery endpoints. Messaging should prefer platform-mediated channels.

4. **Server-side authorization**  
   Every message, notification, and document access is evaluated against Role + Building + Resource + Action.

5. **Auditability**  
   Sensitive communication events and document actions are logged.

6. **Channel abstraction**  
   The core domain must not depend on a specific SMS, email, or push provider.

---

# 4. Notification Domain

## 4.1 Purpose of Notifications

Notifications inform users about events that require awareness or action:

- New invoice / charge
- Payment success / failure
- Maintenance request status change
- Work order assignment / completion
- Election milestones
- Handover actions
- Document expiry
- Contract expiry
- Building announcements
- Invitation received / accepted
- Membership / role changes

## 4.2 Notification Entity

Recommended:

```text
Notification
----------------------------
Id
BuildingId          nullable (some platform-level)
UserId
Type
Title
Body
DataPayload         (structured JSON)
ChannelPreference
Priority
Status
CreatedAt
ReadAt
ExpiresAt
```

## 4.3 Notification Status

```text
Pending
Queued
Sent
Delivered
Failed
Read
Expired
Cancelled
```

## 4.4 Notification Types (Minimum Catalog)

```text
Finance.InvoiceIssued
Finance.PaymentSucceeded
Finance.PaymentFailed
Finance.OverdueReminder

Maintenance.RequestCreated
Maintenance.Assigned
Maintenance.StatusChanged
Maintenance.Completed
Maintenance.VerificationRequired

Governance.ElectionScheduled
Governance.VotingOpen
Governance.VotingClosingSoon
Governance.ResultPublished
Governance.HandoverStarted
Governance.HandoverActionRequired

Membership.InvitationReceived
Membership.InvitationAccepted
Membership.RoleChanged
Membership.MembershipRevoked

Document.ExpiringSoon
Document.Expired
Contract.ExpiringSoon
Contract.Expired

Announcement.BuildingNotice
Announcement.Emergency

System.SecurityAlert
```

The catalog must be extensible without code changes to the core engine.

## 4.5 Notification Priority

```text
Low
Normal
High
Critical
```

Critical notifications (emergency maintenance, security) may bypass certain user quiet-hour preferences according to policy.

## 4.6 Delivery Channels

Supported channels (abstracted):

```text
InApp
Push
SMS
Email
```

Channel selection rules:

- Prefer InApp + Push for most operational events.
- Use SMS / Email for high-importance or when push is unavailable.
- Respect user preferences unless the event is Critical and policy allows override.

## 4.7 Channel Abstraction

```text
INotificationChannel
```

Conceptual methods:

```text
Send(NotificationMessage)
GetDeliveryStatus(Reference)
```

Concrete adapters (examples):

- InAppChannel
- PushChannel (FCM / APNs abstraction)
- SmsChannel
- EmailChannel

The domain must remain independent of any specific provider.

## 4.8 Notification Preferences

Recommended:

```text
UserNotificationPreference
----------------------------
Id
UserId
BuildingId          nullable (global vs building-scoped)
Channel
NotificationType
Enabled
QuietHoursStart
QuietHoursEnd
UpdatedAt
```

Users may disable non-critical categories. Critical/emergency categories may be restricted from complete disablement.

## 4.9 Template System

Notifications should use templates rather than hard-coded strings.

Recommended:

```text
NotificationTemplate
----------------------------
Id
Type
Language
TitleTemplate
BodyTemplate
Channels
Status
```

Supported languages (minimum):

```text
fa
en
```

Templates must support variable substitution from the DataPayload.

## 4.10 Idempotency & Deduplication

The same logical event must not generate duplicate notifications for the same user within a defined window.

Recommended uniqueness concept:

```text
UserId + Type + ReferenceType + ReferenceId + TimeWindow
```

## 4.11 Retry & Failure Handling

Failed deliveries must be retried according to a controlled policy.

```text
MaxRetries
BackoffStrategy
DeadLetter / Failed Status
```

Permanent failures must be visible to operational monitoring.

---

# 5. In-App Messaging Foundation

## 5.1 Purpose

Provide a controlled channel for operational conversation:

- Manager ↔ Resident (about unit issues)
- Manager ↔ Provider (about work orders)
- Work-order specific threads
- Building announcement comments (optional)

Messaging is **not** intended to become a general social network.

## 5.2 Conversation Entity

Recommended:

```text
Conversation
----------------------------
Id
BuildingId
Type
Subject
RelatedEntityType   (WorkOrder, ServiceRequest, Unit, Announcement, ...)
RelatedEntityId
Status
CreatedBy
CreatedAt
ClosedAt
```

Conversation Types:

```text
WorkOrder
ServiceRequest
UnitIssue
BuildingAnnouncement
DirectOperational
System
```

## 5.3 Participant

```text
ConversationParticipant
----------------------------
Id
ConversationId
UserId
RoleInConversation
JoinedAt
LeftAt
Status
```

A participant must have an active, authorized relationship to the Building (or related WorkOrder/Unit).

## 5.4 Message

```text
Message
----------------------------
Id
ConversationId
SenderUserId
Body
MessageType
AttachmentCount
CreatedAt
EditedAt
DeletedAt
Status
```

MessageType:

```text
Text
Image
Document
SystemEvent
```

## 5.5 Message Rules

- Messages are immutable after a short edit window (or completely immutable after send).
- Soft-delete is preferred over hard-delete.
- System events (status changes) may be injected as messages.
- Media attachments must pass the same security rules as documents.

## 5.6 Work-Order Communication

Every WorkOrder may have (or be linked to) a dedicated conversation.

Benefits:

- Context stays attached to the operational record.
- New participants (e.g. assigned provider) can be added safely.
- History survives manager changes.

## 5.7 Provider Communication Privacy

Before assignment:

- No direct messaging with providers from discovery screens.
- No exposure of private contact details.

After assignment:

- Platform-mediated conversation is preferred.
- Direct phone/email exposure remains policy-controlled (see BM-00 and BM-05).

## 5.8 Closing Conversations

Conversations related to closed WorkOrders or resolved issues should be closeable.

Closed conversations become read-only for ordinary participants.

---

# 6. Building Announcements / Notices

## 6.1 Purpose

Managers need a reliable way to publish official notices to building members.

Examples:

- Water shutdown
- Elevator maintenance schedule
- Meeting invitation
- New regulation
- Emergency alert

## 6.2 Announcement Entity

Recommended:

```text
BuildingAnnouncement
----------------------------
Id
BuildingId
Title
Body
Priority
AudienceScope
Status
PublishedAt
ExpiresAt
CreatedBy
CreatedAt
```

AudienceScope examples:

```text
AllMembers
OwnersOnly
ResidentsOnly
SpecificUnits
ManagersAndStaff
```

## 6.3 Announcement Lifecycle

```text
Draft
 ↓
Published
 ↓
Expired / Archived
```

Critical/emergency announcements may support forced push/SMS according to policy.

## 6.4 Read Tracking (Optional)

For important notices the system may track:

```text
AnnouncementRead
----------------------------
AnnouncementId
UserId
ReadAt
```

This supports later compliance and communication effectiveness metrics.

---

# 7. Document Foundation

BM-07 provides the **foundational** document model. Full contract lifecycle, asset linkage, advanced knowledge search, and OCR belong primarily to BM-08.

## 7.1 BuildingDocument (Foundation)

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
ConfidentialityLevel
Status
CurrentRevisionId
CreatedBy
CreatedAt
UpdatedAt
```

## 7.2 Document Revision

```text
DocumentRevision
----------------------------
Id
DocumentId
Version
FileReference
FileName
MimeType
SizeBytes
Checksum
ChangeDescription
UploadedBy
UploadedAt
Status
```

A new upload always creates a new revision. Previous files are retained according to retention policy.

## 7.3 Document Status

```text
Draft
Active
Expired
Superseded
Archived
```

## 7.4 Confidentiality Levels

```text
PublicToBuilding
Members
Managers
Finance
Maintenance
Governance
Restricted
```

Authorization must be enforced server-side before any download or metadata exposure.

## 7.5 File Storage Principles

```text
Application Database  →  Metadata only
Object Storage        →  Actual files
```

Rules:

- Files are never stored inside public web roots.
- Access is always mediated by an authorized endpoint.
- Direct storage URLs must not be permanently public for restricted documents.
- Virus/malware scanning should be applied where available.
- File type validation must use content inspection, not only extension.

## 7.6 Allowed File Categories (Initial)

```text
PDF
Images (JPEG, PNG, WebP)
Office documents (controlled list)
Text
```

Executable files and scripts must be rejected.

## 7.7 Size Limits

Limits must be configurable per category (document / image / video).

## 7.8 Expiry Tracking Foundation

Documents with ExpiryDate participate in the notification engine:

```text
90 days before
30 days before
7 days before
Expired
```

Exact thresholds are configurable.

---

# 8. Relationship to Later Phases

| Concern                        | BM-07                          | BM-08                              |
|--------------------------------|--------------------------------|------------------------------------|
| Basic document storage         | Yes                            | Extended                           |
| Versioning                     | Yes                            | Yes                                |
| Access control                 | Foundation                     | Full matrix                        |
| Contract entity                | No                             | Yes                                |
| Asset register                 | No                             | Yes                                |
| Warranty / Inspection          | No                             | Yes                                |
| OCR / Text extraction          | Ready (interface only)         | Implementation                     |
| Knowledge search / AI          | Ready (interface only)         | Implementation                     |
| Notifications                  | Full engine                    | Consumes                           |
| Messaging                      | Foundation                     | May extend                         |

---

# 9. Privacy Rules

## 9.1 Contact Data

- Phone numbers and emails are private by default.
- They must not appear in general member lists, provider discovery, or public announcement metadata.
- Exposure requires explicit authorization and operational necessity.

## 9.2 Message Content

- Messages may contain personal data; access is limited to conversation participants and authorized auditors.
- Search across all building messages is restricted to high-privilege roles.

## 9.3 Document Content

- Metadata and file content are subject to ConfidentialityLevel.
- Download of sensitive documents must be audited.

## 9.4 Notification Content

- Notification bodies must avoid leaking sensitive data to shared devices or lock screens where possible.
- Prefer generic titles for high-sensitivity events when delivered via SMS/Push.

---

# 10. Authorization Model

Every operation evaluates:

```text
Authenticated User
+
Active Membership / Role
+
Building Scope
+
Resource (Conversation / Document / Announcement)
+
Action (Read, Write, Publish, Download, ...)
```

Examples:

- A resident can read announcements targeted at residents.
- A resident can participate only in conversations they are added to.
- A manager can publish announcements and manage documents within their building.
- A provider can access only conversations related to assigned work orders.
- Cross-building access is denied by default.

---

# 11. Audit Requirements

Minimum audit events:

- Notification created / failed / read
- Preference changes
- Conversation created / closed
- Participant added / removed
- Message sent / soft-deleted
- Announcement published / archived
- Document uploaded
- Document revision created
- Document downloaded (sensitive)
- Document archived
- Access denied events (security-relevant)

Audit records must include:

```text
Who
What
When
BuildingId
Resource
Before / After (where applicable)
Source
```

---

# 12. API Boundaries (Suggested)

Notifications:

```text
GET  /api/users/me/notifications
POST /api/users/me/notifications/{id}/read
GET  /api/users/me/notification-preferences
PUT  /api/users/me/notification-preferences
```

Messaging:

```text
GET  /api/buildings/{buildingId}/conversations
POST /api/buildings/{buildingId}/conversations
GET  /api/conversations/{id}
POST /api/conversations/{id}/messages
POST /api/conversations/{id}/participants
POST /api/conversations/{id}/close
```

Announcements:

```text
GET  /api/buildings/{buildingId}/announcements
POST /api/buildings/{buildingId}/announcements
POST /api/announcements/{id}/publish
```

Documents (foundation):

```text
GET  /api/buildings/{buildingId}/documents
POST /api/buildings/{buildingId}/documents
GET  /api/documents/{id}
POST /api/documents/{id}/revisions
GET  /api/documents/{id}/download
POST /api/documents/{id}/archive
```

All endpoints must enforce building-scoped authorization.

---

# 13. Data Isolation & Multi-Tenancy

- Every Conversation, Announcement, Document, and Notification (where building-scoped) carries BuildingId.
- Queries must always be filtered by authorized Building scope.
- A user belonging to Building A must never receive messages or documents from Building B through ID manipulation.

---

# 14. Performance & Scalability Notes

- Notification dispatch should be asynchronous (queue / outbox).
- Message history should support pagination.
- Document metadata queries must not load file binaries.
- Large file uploads should use resumable / direct-to-storage patterns where appropriate.
- Read models may be introduced later for notification inboxes and conversation lists.

---

# 15. Localization

- Notification templates and system messages must support `fa` and `en`.
- User preferred language (from Person/Profile) drives template selection.
- Timestamps are stored in UTC and displayed according to building or user timezone.

---

# 16. Security Requirements

Mandatory:

- Authentication on all endpoints
- Building-scoped authorization
- Conversation participant checks
- Document confidentiality enforcement
- Secure file delivery (no permanent public links for restricted files)
- Input validation and file-type inspection
- Rate limiting on message and notification endpoints
- Protection against IDOR/BOLA
- Audit of sensitive actions
- No secrets or private contact data in notification payloads sent to untrusted channels

---

# 17. Testing Requirements

### Notifications
- Correct routing by type and preference
- Quiet hours respected (non-critical)
- Critical override behavior
- Idempotent creation
- Retry on transient failure
- Multi-language templates

### Messaging
- Participant authorization
- Cross-building isolation
- Work-order conversation access
- Soft-delete behavior
- Attachment security

### Announcements
- Audience scoping
- Publish permissions
- Expiry handling

### Documents
- Upload + revision creation
- Confidentiality enforcement
- Unauthorized download blocked
- Expiry notification triggers

### Security
- IDOR on conversations and documents
- Provider cannot access unrelated building data
- Former manager loses write access after term end

---

# 18. Suggested Core Entities

```text
Notification
NotificationTemplate
UserNotificationPreference
NotificationDelivery

Conversation
ConversationParticipant
Message
MessageAttachment

BuildingAnnouncement
AnnouncementRead

BuildingDocument
DocumentRevision
DocumentType
```

---

# 19. Relationship Overview

```text
Building
   │
   ├── Announcements
   │
   ├── Conversations ──────── Participants (Users)
   │         │
   │         └── Messages
   │
   ├── Documents ──────────── Revisions ─── Files
   │
   └── (triggers) Notifications ─── Users
```

Cross-links:

- WorkOrder → Conversation
- ServiceRequest → Conversation
- Invoice / Payment events → Notifications
- Document expiry → Notifications
- Election / Handover events → Notifications (from BM-06)

---

# 20. Acceptance Criteria

BM-07 is complete only when:

- [ ] Notification engine exists with channel abstraction
- [ ] Notification templates support fa / en
- [ ] User notification preferences work
- [ ] In-app notification inbox works
- [ ] Push / SMS / Email adapters are pluggable
- [ ] Deduplication / idempotency is enforced
- [ ] Conversation model exists
- [ ] Work-order linked conversations work
- [ ] Participant authorization is enforced
- [ ] Messages support text and controlled attachments
- [ ] Building announcements can be published with audience scope
- [ ] Document foundation (metadata + revision) exists
- [ ] File upload and secure download work
- [ ] Confidentiality levels are enforced server-side
- [ ] Document expiry can trigger notifications
- [ ] Cross-building isolation is tested
- [ ] Sensitive document downloads are audited
- [ ] Former managers lose inappropriate write access
- [ ] Privacy rules for contact data are enforced
- [ ] Audit trail covers communication and document events

---

# 21. Definition of Done

BM-07 is **COMPLETE** only when:

1. Users receive reliable notifications for core financial, maintenance, membership, and governance events.
2. Notification delivery is asynchronous, idempotent, and preference-aware.
3. In-app messaging supports operational conversations scoped to Building / WorkOrder.
4. Provider communication can occur without exposing private phone numbers by default.
5. Managers can publish building announcements to defined audiences.
6. Basic document upload, versioning, and authorized download work.
7. Document confidentiality is enforced on every access.
8. All communication and document actions are properly authorized and audited.
9. The foundation is ready for BM-08 to extend contracts, assets, and advanced knowledge features.
10. No BM-07 implementation violates BM-00–BM-06 principles.

---

# 22. Explicit Non-Goals

Do not fully implement in BM-07:

- Full contract lifecycle and amendments
- Asset register and hierarchy
- Warranty and inspection management
- OCR and full-text knowledge extraction
- AI-assisted document Q&A
- General-purpose social feed or chat rooms
- Real-time voice/video calling
- Advanced notification analytics / A-B testing
- Marketing / promotional messaging engine

These belong to BM-08 or later specialized phases.

---

# 23. BM-07 Architecture Gate

Mandatory distinctions:

```text
Notification ≠ Message
Message ≠ Announcement
Document ≠ Contract
File ≠ Document Metadata
Conversation ≠ WorkOrder
Channel Adapter ≠ Domain Logic
```

And:

```text
Platform-mediated communication
        ≠
Forced locking of all contact outside the platform
```

The platform provides safe, auditable channels while remaining useful even if some communication eventually happens outside it.

---

# 24. Final Principle

> **A well-run building needs timely information, clear official notices, controlled operational conversation, and reliable access to its documents. BM-07 supplies the nervous system of the platform — notifications, messaging, and document foundation — so that financial, maintenance, and governance processes defined in earlier phases can actually reach the people who need to act.**

---

## BM-07 Status

**Status:** Implementation Baseline

**Depends On:**
- BM-00 — Foundation & Product Architecture
- BM-01 — Organization, Building & Unit Foundation
- BM-02 — Owners, Residents, Roles & Building Membership
- BM-03 — Finance, Monthly Charges & Ledger
- BM-04 — Payment Provider Integration & Reconciliation
- BM-05 — Building Operations, Maintenance & Service Provider Network
- BM-06 — Governance, Voting, Management Election & Handover

**Next Phase:** BM-08 — Contracts, Documents, Assets & Building Knowledge

**Implementation Rule:**  
Notification and messaging logic must remain channel-agnostic. Document storage must keep metadata and binary content separated. Privacy of contact details and document confidentiality must be enforced server-side. BM-07 must not re-implement finance, maintenance, or election business rules — it only communicates and stores information about them.
