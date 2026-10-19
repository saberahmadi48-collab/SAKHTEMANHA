# BM-05 Decision Governance Register

**Document status:** Governance register; A–H decisions remain open  
**Scope:** Decision closure and evidence governance for BM-05  
**Implementation status:** BLOCKED  
**Authoritative BM-05 specification:** [BM-05 Building Operations, Maintenance & Service Provider Network](./BM-05_Building_Operations_Maintenance_Service_Provider_Network_v1.0.md)

## 1. Purpose and Scope

This register provides a traceable home for BM-05 decisions A–H, owner questions, evidence requests, approval history, and cross-specification dependencies. It supplements the authoritative BM-05 specification; it does not replace that specification or establish application behavior.

It covers design governance only. It does not authorize application-code changes, schema or migration work, tests, database operations, deployment, or any other implementation.

## 2. Governance Rules and Approval Boundaries

- D-01 through D-14 in the BM-05 specification are approved **design constraints only**. They are not implementation approval.
- The A–H classifications below are the current tracking classifications. No A–H proposal is approved by this register or by the authorization to create it.
- A recommendation is not an approval. “Ready for Review” means the evidence package is assembled, not that the decision is accepted.
- Record only explicit, traceable approvals from the appropriate owner. Never infer approval from silence, meeting attendance, draft wording, or approval of D-01–D-14.
- Keep actual evidence, assumptions, recommendations, and owner decisions distinct. Do not invent approvers, identities, dates, signatures, roles, datasets, licenses, capabilities, test results, or guarantees.
- Preserve decision and evidence history. Supersede records by reference; do not erase prior entries.
- Do not store secrets, credentials, tokens, private personal data, or sensitive evidence. Use a controlled reference to restricted evidence where necessary.
- BM-05 §§78–79 require map-based Discovery for full acceptance. An API-only or area-only slice does not satisfy that requirement.
- Do not claim atomicity across a database and object storage or other external systems.
- Keep BM-04 financial-ledger idempotency rules separate from the general BM-05 idempotency contract. Maintenance financial posting remains within BM-03's finance boundary.
- Proposed actor categories in this register are not existing application roles unless independently verified in current source.

### Decision lifecycle

`Open → Evidence Gathering → Ready for Review → Pending Approval → Approved / Rejected / Deferred`

Use `Blocked` when an unresolved dependency or specialist review prevents progress. Evidence status uses the vocabulary in [§5](#5-evidence-register). A decision may be marked approved only when its approval source, approving authority or role, date if evidenced, rationale, conditions, and supporting evidence can be recorded.

## 3. Master Decision Register

| ID | Decision | Current classification | Accountable owner role(s) | Key dependencies | Current disposition |
|---|---|---|---|---|---|
| A | Verification cases and evidence lifecycle | Specialist Approval Required | Product owner; document/evidence-storage owner; security and privacy/legal owners | F, verified storage and scanning capabilities, D/E | Case-first lifecycle is a candidate, not approved. |
| B | Platform privilege bootstrap | Evidence Required | Security and identity owner; operations owner | F, actual identity/deployment mechanisms | Bootstrap operator, approval quorum, delivery and recovery arrangements remain unresolved. |
| C | Emergency revocation and platform freeze | Specialist Approval Required | Security and identity owner; operations owner | B, F, deployment/cache evidence | Grant revocation, freeze, outage and restoration behavior require specialist review. |
| D | Durability, transactions and recovery | Recommended Default — Owner Approval Required | Operations and database owner; engineering owner | A, actual external integrations, E | DB atomicity for critical state is proposed; external effects require separately defined recovery. |
| E | Operation-specific idempotency | Recommended Default — Owner Approval Required | Product/API owner; database and security owners | D, endpoint inventory | Contract and endpoint coverage remain to be approved; BM-04 ledger rules do not define it. |
| F | Provider, platform and building actor boundaries | Recommended Default — Owner Approval Required | Product owner; security and identity owner | Existing authorization model; B, C, A | Scope separation is an approved design principle; exact actor/permission matrix remains proposed. |
| G | Geographic source, mapping and Discovery audience | Evidence Required | Geographic-data owner; product and privacy/legal owners | H, source and license evidence, map design | Dataset, license, hierarchy, maintenance, and audience remain unresolved. |
| H | Audience-specific public-field allowlist | Specialist Approval Required | Product owner; privacy/legal and security owners | G, BM-00/BM-07 review | Field- and audience-level exposure policy requires approval. |

## 4. Decision Records

### A — Verification Cases and Evidence Lifecycle

**Current classification:** Specialist Approval Required

- **Existing approved design constraints:** D-06 requires opaque, storage-issued references; rejects client-supplied URLs, paths, storage keys, or arbitrary references; requires ownership and authorization checks, completed upload and safety scanning, purpose-limited access, and access audit. Evidence-backed submission/review is not usable until secure storage and platform review authority exist.
- **Proposed decision and recommended default:** Avoid the case/upload circularity with `draft case → case-bound upload authorization → evidence finalization and validation → submission for review`. Keep evidence references bound to the correct provider and case; make replacements explicit and preserve prior review history.
- **Alternatives and trade-offs:** Upload to an unbound temporary session and attach later. This may simplify initial upload but increases orphan cleanup, ownership binding, and unauthorized attachment risks. Exact versioning, withdrawal, and reopening rules remain undecided.
- **Accountable owner roles:** Product owner; document/evidence-storage owner; security and privacy/legal owners.
- **Exact approval question:** “Do we approve case-first, case-bound upload authorization followed by evidence finalization and validation before submission? Who may create, submit, withdraw, reopen, replace, and review a case, and under what conditions?”
- **Required evidence:** Actual storage and scanning capabilities; upload completion/failure semantics; supported file types and size limits; evidence ownership enforcement; access audit; retention/deletion policy; cleanup and retry behavior. Do not choose numeric limits or retention periods without evidence and owner approval.
- **Acceptance criteria:** The lifecycle is non-circular; every upload is bound to an authorized provider and case; invalid, incomplete, unsafe, or unauthorized evidence cannot be submitted or retrieved; replacement and withdrawal preserve history; external storage failures have defined recoverable states; the approved storage and review path is operationally supported.
- **Dependencies, risks, and unresolved issues:** Depends on F for actors and separation of duties, D/E for failure/retry semantics, and verified storage/scanning operations. Database state and object-storage effects are not cross-system atomic.

### B — Platform Privilege Bootstrap

**Current classification:** Evidence Required

- **Existing approved design constraints:** D-03 requires global actions to use separate server-resolved platform grants, independent of organization, building, or provider membership. Bootstrap and emergency revocation must be configured before platform actions are enabled; platform grants must be independently auditable and unavailable through ordinary tenant roles.
- **Proposed decision and recommended default:** Define a controlled bootstrap mechanism only after the actual identity and deployment environment is evidenced. Require constrained initial grant creation, auditable outcomes, and protection against unintended repeated or concurrent bootstrap. No particular operator, identity provider, quorum, or recovery channel is selected here.
- **Alternatives and trade-offs:** An application-managed bootstrap or an identity/deployment-managed bootstrap may be considered after verification. Either could reduce some operational dependencies while introducing others; the repository evidence does not establish which exists or is suitable.
- **Accountable owner roles:** Security and identity owner; operations owner.
- **Exact approval question:** “What verified mechanism establishes the initial platform grant, who is accountable for operating it, what approval or quorum is required, how are any bootstrap secrets delivered, and how is access recovered if authorized administrators are unavailable?”
- **Required evidence:** Actual identity/deployment architecture, bootstrap execution path, operator ownership, secret-delivery method, audit behavior, repeat/concurrency controls, and recovery runbook. Bootstrap operator, approval quorum, and recovery arrangements remain unresolved.
- **Acceptance criteria:** An approved, tested runbook exists; ordinary tenant/provider roles cannot bootstrap; repeated and concurrent attempts cannot create unintended grants; success and failure are auditable; recovery is defined and independently reviewed.
- **Dependencies, risks, and unresolved issues:** Depends on F’s privilege and actor boundaries and blocks C. No bootstrap authority or operational mechanism is established by the current documentation.

### C — Emergency Revocation and Platform Freeze

**Current classification:** Specialist Approval Required

- **Existing approved design constraints:** D-03 separates platform authority from tenant roles and requires independent audit. Current authentication behavior must not be treated as proof that platform-grant revocation propagates through all instances.
- **Proposed decision and recommended default:** Define individual platform-grant revocation separately from any scoped or global privileged-operation freeze. Fail closed for privileged actions when current authority cannot be established; specify who can restore access and how restoration is reviewed.
- **Alternatives and trade-offs:** Support individual grant revocation only and rely on an incident procedure for broader shutdown. This is simpler but may not satisfy incidents that require suspending platform operations globally.
- **Accountable owner roles:** Security and identity owner; operations owner.
- **Exact approval question:** “Who may revoke an individual platform grant or freeze privileged operations, what independent approval is required for restoration, and what must happen when authorization state or its backing service is unavailable?”
- **Required evidence:** Actual grant lookup, cache and multi-instance topology; revocation propagation; outage and fail-closed behavior; monitoring; incident response and restoration procedure.
- **Acceptance criteria:** Verified tests or operational evidence cover grant revocation, stale authorization, multi-instance propagation, authorization outages, fail-closed privileged operations, alerting, and controlled restoration.
- **Dependencies, risks, and unresolved issues:** Depends on B for bootstrap/root-of-trust and F for actor boundaries. Existing token validation alone does not prove these controls.

### D — Durability, Transactions and Recovery

**Current classification:** Recommended Default — Owner Approval Required

- **Existing approved design constraints:** BM-05 D-10 requires transactions for multi-row writes and audit. The existing audit service documents a transaction-bound method for atomic audit and mutation. Ordinary audit logging has a swallow-on-failure behavior and cannot establish that a critical mutation was recorded.
- **Proposed decision and recommended default:** For critical database-only changes, commit domain state, required history/audit, and applicable idempotency outcome together or roll them back. For object storage, scanning, notifications, and other external effects, define explicit staged states, retry, reconciliation, and observability as needed. Do not claim cross-system atomicity.
- **Alternatives and trade-offs:** Introduce a durable outbox or other delivery mechanism for external effects if actual integrations and operational ownership justify it. This may improve recovery but adds components and operational responsibilities. Direct best-effort side effects are not an equivalent guarantee.
- **Accountable owner roles:** Operations and database owner; engineering owner.
- **Exact approval question:** “Do we approve transactional consistency for critical database state, required audit/history, and applicable idempotency outcomes, with explicit recovery and reconciliation for external effects? Which effects are in scope, and who owns each recovery path?”
- **Required evidence:** Actual transaction boundaries and external integrations; audit failure behavior; retry, reconciliation, monitoring and ownership; backup/restore evidence before proposing RPO/RTO. RPO/RTO remain unresolved.
- **Acceptance criteria:** Each critical operation has a transaction/failure contract; critical audit failure prevents the mutation from committing; external partial completion is detectable and has an owned recovery path; any recovery objectives are evidence-backed and explicitly approved.
- **Dependencies, risks, and unresolved issues:** Must be resolved before E. No cross-system transaction, backup capability, recovery objective, or external delivery guarantee is established here.

### E — Operation-Specific Idempotency

**Current classification:** Recommended Default — Owner Approval Required

- **Existing approved design constraints:** BM-05 D-10 calls for database uniqueness and safe same-key/same-payload replay, conflict on key reuse with a different payload, transactions, and concurrency-safe state changes. BM-04 defines payment-specific idempotency, including payment-intent and callback concerns; those rules are not the general BM-05 contract.
- **Proposed decision and recommended default:** Define idempotency by retry-sensitive operation rather than assuming every write uses identical rules. For each covered operation specify key scope, canonical request fingerprint, same-key replay, mismatch conflict, concurrent duplicates, in-progress state, failure behavior, reauthorization before replay, and retention.
- **Alternatives and trade-offs:** Require keys for every mutation. This can simplify client retry expectations but increases persistence and contract complexity; it still does not solve external-effect recovery by itself.
- **Accountable owner roles:** Product/API owner; database and security owners.
- **Exact approval question:** “Which BM-05 operations require idempotency keys, and what are the approved key scope, payload fingerprint, replay response, conflict, concurrency, in-progress, failure, reauthorization, and retention rules for each?”
- **Required evidence:** Complete write-endpoint inventory, operation-specific external-effect map from D, and persistence/concurrency design. The finance-specific ledger uniqueness scope must not be generalized.
- **Acceptance criteria:** Same-key concurrent requests yield one intended effect; mismatched payload reuse does not execute; committed operations can be safely resolved after client timeout; replay responses are authorized and do not disclose data to revoked or out-of-scope callers; retention is explicit and supportable.
- **Dependencies, risks, and unresolved issues:** Depends on D and endpoint inventory. BM-04 payment idempotency remains a separate financial contract.

### F — Provider, Platform and Building Actor Boundaries

**Current classification:** Recommended Default — Owner Approval Required

- **Existing approved design constraints:** D-01/D-03/D-09 separate provider membership, platform grants, and organization/building scope. Provider actions use the authenticated user’s active provider membership; platform actions use separate grants. No scope or grant is trusted from request bodies or JWT role claims. Existing tenant roles and `WORKORDER_READ` do not imply global provider or platform authority.
- **Proposed decision and recommended default:** Maintain separate, server-resolved provider, building, organization, and platform scopes; deny by default; define a resource/action matrix and separation-of-duties rules before enabling actions. Proposed reviewer, bootstrap-operator, and emergency-operator categories must remain proposals until approved and implemented.
- **Alternatives and trade-offs:** A smaller number of actor categories with explicit per-action permissions may be easier to govern but may require more detailed policy checks. A broad shared administrator role would be simpler but risks privilege conflation and cross-scope access.
- **Accountable owner roles:** Product owner; security and identity owner.
- **Exact approval question:** “Which actor categories are required, what may each do on which provider/building/platform resources, who may grant and revoke each capability, and which actions require separation of duties or independent review?”
- **Required evidence:** Current implemented role inventory; resource/action permission matrix; membership and grant lifecycle; tenant isolation and row-level access requirements; separation-of-duties rationale.
- **Acceptance criteria:** Every operation has a documented server-resolved scope and permission; cross-provider and cross-building access is denied absent explicit authority; user-supplied identity/role/scope cannot grant access; self-review and conflicting duties are explicitly controlled.
- **Dependencies, risks, and unresolved issues:** Foundational to A, B and C, and informs G/H audience checks. Do not label proposed actor categories as implemented roles.

### G — Geographic Source, Mapping and Discovery Audience

**Current classification:** Evidence Required

- **Existing approved design constraints:** D-04/05 require an owner-approved authoritative source, explicit building-area mapping, exact-area matching for the first slice, and fail-closed behavior for missing, retired, or ambiguous mappings. Free-text address fields must not be silently mapped, and missing mapping must not trigger an all-area search. BM-05 §§78–79 require map-based Discovery for full acceptance.
- **Proposed decision and recommended default:** Keep dataset, license, and provider unresolved until a candidate is supported by source, ownership, rights, hierarchy, and maintenance evidence. Decide anonymous Discovery separately from authenticated, authorized building-scoped Discovery. Keep mapping explicit and fail closed.
- **Alternatives and trade-offs:** Defer geographic discovery until a licensed source and map design are approved. This avoids unsupported data use but delays a required full-acceptance capability. No source, map SDK, PostGIS, radius engine, or distance method is selected by this register.
- **Accountable owner roles:** Geographic-data owner; product owner; privacy/legal owner.
- **Exact approval question:** “Which source and license are approved, who maintains it, what jurisdiction, stable identifiers, hierarchy and version semantics apply, and is Discovery anonymous or restricted to authenticated and authorized building contexts?”
- **Required evidence:** Dataset provenance and owner; license and permitted use; jurisdiction; stable identifier and parent semantics; update/version and retirement process; ambiguity handling; map/location privacy assessment; audience decision.
- **Acceptance criteria:** Source and licensing are evidenced and approved; each building mapping is explicit and auditable; stale, absent, retired, or ambiguous mappings fail closed; no free-text inference or all-area fallback occurs; map-based requirements and privacy constraints in §§78–79 are satisfied before BM-05 is considered complete.
- **Dependencies, risks, and unresolved issues:** Must be decided with H. Dataset, license, hierarchy, and audience are unresolved. Area-based API discovery alone does not satisfy the map requirement.

### H — Audience-Specific Public-Field Allowlist

**Current classification:** Specialist Approval Required

- **Existing approved design constraints:** D-07 requires an explicit discovery allowlist and excludes private contact, street address, exact/private coordinates, national ID, evidence references, internal User IDs, private account metadata, and unverified statistics. BM-00 requires privacy by design and approximate location; BM-07 keeps contact details private by default and restricts access by role, building, resource, and action.
- **Proposed decision and recommended default:** Define field allowlists separately for anonymous users, authenticated but unauthorized users, authorized building Discovery, provider self-access, reviewers, and privileged operations. Default to no disclosure. “Public field” does not mean Discovery is anonymous.
- **Alternatives and trade-offs:** Restrict Discovery to authenticated, authorized building contexts until anonymous exposure is reviewed. This reduces public exposure but may reduce discoverability. Any later post-selection operational contact flow must be separately authorized and is not blanket permission to expose contact details in Discovery.
- **Accountable owner roles:** Product owner; privacy/legal and security owners.
- **Exact approval question:** “For each audience, which exact provider fields may be returned, at what geographic precision and for what purpose, and what consent, moderation, and access rules apply? Is any Discovery anonymous?”
- **Required evidence:** Field-level classification and purpose; consent/moderation requirements; location inference assessment; approved response and map serializers; nested-object, export, cache, and logging behavior.
- **Acceptance criteria:** A versioned server-side allowlist exists for each approved audience; unauthorized/anonymous paths are distinct; private contact, precise location, identity data, evidence references, internal identifiers, and reviewer notes cannot leak through APIs, maps, nested resources, exports, caches, or logs.
- **Dependencies, risks, and unresolved issues:** Depends on G’s source, precision, and audience decisions and on cross-document review of BM-00/BM-07. No field beyond existing constraints is approved for exposure by this register.

## 5. Evidence Register

Evidence status means:

`Not Requested | Requested | Received | Under Review | Verified | Insufficient | Rejected | Superseded`

“Verified” here means the cited source was checked for what it states; it does not mean that a specialist has approved its conclusions or that a described capability exists in production.

| Evidence ID | Decision(s) | Description and source/reference | Evidence owner role | Status | Verification method and limitations | Sufficient to decide? |
|---|---|---|---|---|---|---|
| EV-BM05-001 | A–H | Approved-design addendum, D-01–D-14, and map/implementation boundary in [BM-05 specification](./BM-05_Building_Operations_Maintenance_Service_Provider_Network_v1.0.md), especially the addendum beginning “Approved Design Addendum — Provider Management and Discovery Contract.” | Product owner for contract; specialist owners for their domains | Verified | Document content inspected. It records design constraints, not deployed capabilities or A–H approvals. | Insufficient for implementation or A–H closure. |
| EV-BM00-001 | G, H | [BM-00 foundation](./BM-00_Building_Management_Platform_Foundation_v1.0.md), §§23–25 and related privacy provisions. | Product and privacy/legal owners | Verified | Specification reviewed for map and approximate-location principles; not a map implementation or a field-level audience approval. | Insufficient for geographic source or detailed allowlist. |
| EV-BM07-001 | A, H | [BM-07 communications and documents](./BM-07_Communication_Notifications_Documents_Foundation_v1.0.md), including privacy, authorization, audit, and document-storage sections. | Document/evidence-storage owner; privacy/legal and security owners | Verified | Specification reviewed. Does not prove an evidence service, scanning, retention policy, or BM-05 reviewer capability exists. | Insufficient for A/H closure. |
| EV-BM04-001 | D, E | [BM-04 payment integration](./BM-04_Payment_Provider_Integration_Reconciliation_v1.0.md), including its payment idempotency and reconciliation sections. | Product/API and finance owners | Verified | Finance-specific contract reviewed. It does not establish a BM-05 idempotency policy or external-effect guarantees for BM-05. | Insufficient for general BM-05 contract. |
| EV-REPO-001 | B, C, D, F | Current source inspection referenced in the preceding read-only audit: authentication, scope resolution, audit behavior, and E2E reset safety. Exact implementation references are available in the audit record/conversation; no separate evidence package is stored here. | Security/identity; operations/database; engineering owners | Received | Prior audit findings are context, not a substitute for re-verifying current source before an implementation decision. Authentication checks alone do not prove platform-grant revocation or multi-instance behavior. | Insufficient; current operational topology and behavior evidence needed. |
| EV-STORAGE-001 | A | Actual evidence/object-storage, scanning, upload-finalization, access-audit, cleanup, and retention capabilities. Controlled reference to be supplied by the storage owner; do not attach sensitive evidence here. | Document/evidence-storage owner | Not Requested | No verified capability package or policy is recorded in this register. | No. |
| EV-BOOTSTRAP-001 | B, C | Actual identity/deployment bootstrap, operator ownership, approval, secret delivery, audit, and recovery procedure. Controlled reference to be supplied by security/operations. | Security and identity; operations owners | Not Requested | No bootstrap operator, quorum, mechanism, or recovery arrangement is established here. | No. |
| EV-OPS-001 | C, D | Deployment/cache topology, grant-revocation propagation, outage response, monitoring, backup/restore, and recovery ownership. Controlled operational reference. | Operations and database owner | Not Requested | No topology or backup/restore evidence is recorded; do not infer RPO/RTO. | No. |
| EV-IDEMP-001 | D, E | BM-05 write-endpoint inventory, effect boundaries, transaction map, and retry/concurrency design. | Product/API and database owners | Not Requested | No agreed operation-specific contract is recorded. | No. |
| EV-GEO-001 | G, H | Candidate geographic source, ownership, license, jurisdiction, identifiers, hierarchy, versioning, and maintenance evidence. Controlled reference to source terms as needed. | Geographic-data owner; privacy/legal reviewer | Not Requested | No dataset or license is selected or verified. | No. |
| EV-PRIVACY-001 | A, G, H | Evidence classification, audience decisions, location-precision assessment, consent/moderation, and field-level exposure review. | Privacy/legal owner; security owner | Not Requested | No specialist determination is recorded. | No. |

Do not place restricted source files, credentials, personal information, or actual sensitive evidence in this register. Add references only when their access controls and owner are known.

## 6. Approval and Decision History

This section records known provenance without filling gaps by assumption.

| History ID | Decision(s) | Previous → current status | Recorded outcome | Authority/source | Date | Related evidence | Rationale, conditions, or supersession |
|---|---|---|---|---|---|---|---|
| HIST-BM05-D-BASELINE | D-01–D-14 | Design not recorded here → approved design baseline | The BM-05 addendum states that defaults D-01–D-14 were approved as a design contract only and that implementation is not authorized. | Source: D-01–D-14 table in the BM-05 specification. Prior explicit owner approvals were supplied in the conversation; the repository does not contain a named approver, signature, or separate approval artifact. | The addendum states `2026-10-18` as its decision-baseline date. This is the document’s stated date, not an independently recorded signature date. | EV-BM05-001 | Design-only; no code, schema, migration, database, or deployment authorization. No supersession recorded. |
| HIST-BM05-AH-BASELINE | A–H | Not previously registered → current classifications in §3 | The Phase 1 report supplied the classifications and unresolved topics recorded in this register. No A–H decision was approved. | Source: Phase 1 read-only inventory/report in the conversation. No repository approval record identified. | Not separately evidenced in a repository approval artifact. | EV-BM05-001 and applicable evidence entries | These are tracking classifications, not decisions or approvals. Retain until explicit owner evidence changes them. |
| HIST-BM05-REGISTER-CREATE | Register | No register → created | Creation of this governance register only. It does not approve A–H or authorize implementation. | Source: explicit Phase 2A authorization to create this single file. No approver identity or signature is stored here. | 2026-10-18 | Not applicable | No existing file was modified. Future changes require separate authorization within the requested scope. |

Future entries must identify the decision, exact previous and new status, actual outcome, approving authority or owner role when evidenced, approval date only when evidenced, source, related evidence, rationale/conditions, and supersession link. Do not edit history to erase an earlier decision.

## 7. Open Issues and Evidence Requests

| Issue ID | Decision(s) | Missing information / request | Responsible owner role | Blocking dependencies | Closure criteria | Status |
|---|---|---|---|---|---|---|
| OPEN-A-01 | A | Provide supported evidence upload, completion, scanning, ownership, access audit, cleanup, file-type/size policy, and retention/deletion evidence; decide case order and withdrawal/replacement rules. | Document/evidence-storage owner; product; security; privacy/legal | F, D, E | Verified capability and policy evidence; non-circular lifecycle and exact owner answers recorded. | Open / Evidence Required |
| OPEN-B-01 | B | Identify actual bootstrap path, operator owner, approval/quorum, secret delivery, audit, repeat/concurrency behavior, and recovery procedure. | Security and identity; operations | F | Verified mechanism and approved runbook; no invented operator or recovery claim. | Open / Evidence Required |
| OPEN-C-01 | C | Define individual revocation versus freeze, outage behavior, propagation, restoration authority, monitoring, and incident recovery. | Security and identity; operations | B, F | Specialist review based on actual topology; tested or otherwise evidenced behavior and approved incident procedure. | Open / Specialist Review |
| OPEN-D-01 | D | Map critical DB transactions, audit requirements, external effects, retry/reconciliation owners, and backup/restore facts. | Operations and database; engineering | A, E; actual integrations | Operation-level failure/recovery contract approved; RPO/RTO considered only with backup/restore evidence. | Open / Owner Decision and Evidence |
| OPEN-E-01 | E | Inventory BM-05 writes and decide key scope, canonical payload, replay, mismatch, concurrency, in-progress, failure, reauthorization, and retention per operation. | Product/API; database; security | D | Approved operation matrix and testable behavior; explicit separation from BM-04 ledger rules. | Open / Owner Decision |
| OPEN-F-01 | F | Approve actor categories, resource/action matrix, grant/revoke authority, scope resolution, and separation of duties. | Product; security and identity | None; prerequisite to A–C | Explicit matrix approved; existing roles distinguished from proposed categories; server-side boundaries testable. | Open / Owner Decision |
| OPEN-G-01 | G | Supply geographic source/license, source owner, jurisdiction, stable identifiers, hierarchy, version/update process, ambiguity behavior, and Discovery audience. | Geographic-data; product; privacy/legal | H; map acceptance | Evidence-backed source and audience decision; mapping and fail-closed criteria approved; map requirements retained. | Open / Evidence Required |
| OPEN-H-01 | H | Decide anonymous versus authenticated/authorized Discovery and approve audience-specific field allowlists, geographic precision, purpose, consent/moderation, and leakage protections. | Product; privacy/legal; security | G | Field-by-field and audience-by-audience approval with map/API/export/cache/log criteria. | Open / Specialist Review |
| OPEN-XDOC-01 | A, D, E, G, H | Reconcile the evidence, audit, recovery, idempotency, geography, privacy, and map terms across BM-00, BM-05, BM-07, and relevant BM-04 constraints. | Product and relevant specialist owners | A–H evidence/decisions | Smallest exact corrections identified and separately approved before any document edit. | Open |
| OPEN-IMPL-01 | A–H | Obtain separate authorization for a scoped implementation proposal after decision closure; separately approve schema/migration and database/test-target actions when applicable. | Product owner and relevant technical/operational approvers | A–H closure; documentation review | Explicit, bounded implementation authorization and any required database safety approvals recorded. | Blocked |

## 8. Owner Approval Agenda

Each agenda item requires a recorded outcome, the owner role, evidence reviewed, conditions, and unresolved follow-ups. Do not assign named people without verified authority.

### Product Owner

1. **F — Actor boundaries:** Approve or revise actor categories and the resource/action matrix.  
   **Attendees:** Security and identity owner.  
   **Evidence in advance:** Existing authorization inventory; proposed scope/permission matrix.  
   **Exact question:** “Which actors may perform which actions on provider, building, organization, and platform resources, and which actions require independent review?”  
   **Record:** Approved, rejected, or deferred matrix and rationale.  
   **Blocking dependency:** Establishes the actor framework for A, B, and C.
2. **A — Verification workflow:** Decide case creation, submission, withdrawal, replacement, and review policy after storage evidence is available.  
   **Attendees:** Document/evidence-storage, security, privacy/legal owners.  
   **Evidence in advance:** EV-STORAGE-001 and proposed state flow.  
   **Exact question:** See A’s approval question in §4.  
   **Record:** State/actor decisions and unresolved policy items.  
   **Blocking dependency:** F and actual evidence capabilities.
3. **E — Retry-sensitive writes:** Decide which operations require idempotency and client-visible replay semantics.  
   **Attendees:** API and database owners; security owner.  
   **Evidence in advance:** Endpoint/effect inventory and D transaction contract.  
   **Exact question:** See E’s approval question in §4.  
   **Record:** Per-operation idempotency matrix.  
   **Blocking dependency:** D.
4. **G/H — Discovery product policy:** Decide audience and intended provider/building discoverability semantics; approve public fields only with privacy review.  
   **Attendees:** Geographic-data and privacy/legal owners.  
   **Evidence in advance:** EV-GEO-001, EV-PRIVACY-001, map acceptance clauses.  
   **Exact question:** Is any Discovery anonymous, and what approved fields and geographic precision serve each audience?  
   **Record:** Audience and field policy.  
   **Blocking dependency:** Geographic source and privacy/legal review.

### Security and Identity

1. **B/C — Platform authority:** Review bootstrap, revocation, freeze, outage, and restoration controls.  
   **Attendees:** Operations owner; product owner.  
   **Evidence in advance:** EV-BOOTSTRAP-001 and EV-OPS-001.  
   **Exact question:** Which verified authority can establish/revoke grants or freeze operations, and under what approval and recovery process?  
   **Record:** Security-reviewed control and incident requirements.  
   **Blocking dependency:** Actual deployment and identity evidence.
2. **F/A/E — Access and separation of duties:** Review provider/platform/building isolation, evidence review, and replay authorization.  
   **Attendees:** Product/API owner; privacy/legal owner for evidence.  
   **Evidence in advance:** Permission matrix, evidence flow, endpoint-specific replay design.  
   **Exact question:** Are access scopes, reviewer independence, and replay disclosures least-privilege and enforceable?  
   **Record:** Explicit security findings, conditions, and accepted risks.  
   **Blocking dependency:** F actor model and A/E drafts.

### Operations and Database

1. **D — Durability/recovery:** Decide DB transaction/audit expectations and external-effect reconciliation ownership.  
   **Attendees:** Engineering and security owners as needed.  
   **Evidence in advance:** Transaction/effect map, audit failure semantics, EV-OPS-001.  
   **Exact question:** Which critical DB state/audit changes must commit together, and how will each external partial effect be detected and recovered?  
   **Record:** Operation-level failure/recovery table and owners.  
   **Blocking dependency:** Actual integration and infrastructure facts.
2. **B/C/E — Operational feasibility:** Review bootstrap/concurrency behavior, revocation propagation, and idempotency persistence.  
   **Attendees:** Security/identity and API owners.  
   **Evidence in advance:** EV-BOOTSTRAP-001, EV-OPS-001, EV-IDEMP-001.  
   **Exact question:** Are the proposed controls supportable in the actual deployment and database, and what evidence demonstrates that?  
   **Record:** Verified constraints, required tests, and remaining gaps.  
   **Blocking dependency:** Current topology and approved semantics.

### Privacy and Legal

1. **A/H — Evidence and profile exposure:** Review evidence purpose/handling and public-field policy.  
   **Attendees:** Product and evidence-storage owners; security owner.  
   **Evidence in advance:** EV-STORAGE-001 and EV-PRIVACY-001.  
   **Exact question:** What evidence and profile data may be collected or disclosed, to whom, for what purpose, and under what retention/consent rules?  
   **Record:** Field/purpose and evidence-handling determinations with conditions.  
   **Blocking dependency:** Verified storage and product audiences.
2. **G/H — Geography/privacy:** Review licensing and location inference/precision.  
   **Attendees:** Geographic-data and product owners.  
   **Evidence in advance:** EV-GEO-001 and map/API exposure proposal.  
   **Exact question:** Is the proposed source/use licensed, and is the approved precision/audience appropriate?  
   **Record:** Legal/privacy conclusions and permitted-use constraints.  
   **Blocking dependency:** Actual source and field policy.

### Document and Evidence Storage

1. **A — Capability evidence:** Provide the real upload, finalization, scan, access, cleanup, retention/deletion, and audit behavior.  
   **Attendees:** Security, privacy/legal, and product owners.  
   **Evidence in advance:** Architecture/policy references; no sensitive sample evidence in this repository.  
   **Exact question:** Which case-bound evidence lifecycle can the actual service support, with what verified limits and failure behavior?  
   **Record:** Controlled evidence reference, verified capabilities, limitations, and unsupported requirements.  
   **Blocking dependency:** Storage/scanning service and policy evidence.

### Geographic-Data Ownership

1. **G — Dataset and license:** Supply source ownership, permitted use, hierarchy, IDs, provenance, and maintenance process.  
   **Attendees:** Product and privacy/legal owners.  
   **Evidence in advance:** Candidate source terms and technical schema/provenance documentation.  
   **Exact question:** Which evidenced source, if any, may be used for this product and how are updates and ambiguity handled?  
   **Record:** Verified source decision or explicit deferral with required evidence.  
   **Blocking dependency:** No source selection before evidence and license review.

## 9. Cross-Specification Traceability

| Topic | BM-00 | BM-05 | BM-07 | BM-04 / boundary | Reconciliation status |
|---|---|---|---|---|---|
| Map-based Discovery | Provider matching and map architecture are product requirements; approximate location is required. | §§78–79 remain full-acceptance requirements. D-13 defers map UI from the first slice but does not waive acceptance. | Privacy and authorization principles apply to communication/document surfaces; not a map implementation. | No payment-provider dependency is established for provider Discovery. | Keep map as a mandatory later acceptance gate; define audience and map-field exposure through G/H. |
| Evidence privacy and storage | General privacy-by-design rules apply. | D-06 requires opaque references, authorization, scanning, audit, and secure evidence boundary; A remains unresolved. | Document storage, access mediation, confidentiality and sensitive access auditing are relevant reuse constraints, not proof of an evidence service. | Payment evidence/reconciliation is not a substitute for BM-05 verification evidence. | Verify actual storage capabilities before approving A or enabling workflow. |
| Actor and tenant isolation | Platform architecture and privacy principles. | D-03/D-09 keep platform, provider, organization, and building scopes distinct. | Role + building + resource + action authorization; cross-building denied by default. | BM-04 financial operations have their own building and finance scope. | Approve F’s explicit matrix; do not reuse tenant or payment roles as global BM-05 authority. |
| Audit and durability | Platform auditability principles. | D-10/D-11 require critical mutation/audit transaction behavior. | Sensitive document and communication actions are auditable. | Payment reconciliation has finance-specific controls. | D must define critical DB atomicity separately from external storage/notification effects. |
| Idempotency | General platform reliability context. | D-10 gives a proposed BM-05 concurrency/idempotency contract. | Notification retry/idempotency may have its own delivery semantics. | BM-04 §§21–22 and related sections define payment-specific callback/intent idempotency and ledger outcomes. | Define BM-05 operation-by-operation; do not generalize `(buildingId, idempotencyKey)` or payment semantics. |
| Finance boundary | Finance is a distinct platform domain. | BM-05 excludes financial posting from the first slice; later maintenance costs must use BM-03 `Expense`/`LedgerService`, not a parallel ledger. | Communication/document scope only unless a specific workflow is approved. | BM-04 extends the BM-03 finance/payment flow; it does not authorize coupling all BM-05 workflows to payments. | Keep BM-05 maintenance records separate from ledger duplication; integrate finance only where a defined workflow requires it. |
| Geographic catalogue and public fields | Approximate map/location privacy. | D-04/05 require verified source, explicit mapping, and fail-closed search; D-07 is an allowlist proposal. | Contact details are private by default; access is purpose/scope restricted. | No geographic source or public-field permission is provided by BM-04. | G/H must jointly set source, audience, precision, and allowlist. |

### Known gaps or potential conflicts to reconcile

- BM-00 map requirements include approximate building/provider location and approximate distance; BM-05 D-07 limits discovery to coarse covered-area labels and the first slice excludes coordinates/radius/distance. These statements concern different scopes/phases but require an explicit later map-phase contract; do not silently treat area-only matching as full map acceptance.
- BM-05 D-07's “public” field list must be interpreted by audience. It does not decide anonymous versus authenticated, authorized Discovery.
- BM-07 storage and access requirements are reusable constraints, not evidence that an upload/scanning service exists or that BM-05 evidence retention has been decided.
- BM-04’s retry and idempotency rules are finance-specific. No BM-05 operation should inherit them without an explicit, operation-specific decision.

## 10. Closure Sequence and Implementation Gates

Follow this dependency order:

1. **F:** Confirm actor, privilege, scope, and separation-of-duties boundaries.
2. **B/C:** Resolve bootstrap and emergency authority using actual identity/deployment evidence.
3. **A:** Approve evidence lifecycle and storage contract after capability and specialist review.
4. **D:** Decide database atomicity, audit, external effects, and recovery.
5. **E:** Decide idempotency per retry-sensitive BM-05 operation, based on D and without importing finance-specific assumptions.
6. **G:** Obtain geographic source, license, hierarchy, maintenance, and mapping evidence; retain map acceptance.
7. **H:** Approve Discovery audience and field-level allowlists with privacy/security review.
8. Reconcile BM-00, BM-05, BM-07, and applicable BM-04 constraints; document conflicts and exact proposed corrections.
9. Obtain separate explicit authorization for any documentation changes.
10. Obtain separate explicit authorization for a bounded implementation proposal. Obtain separate approvals for schema/migrations, database target/operations, and DB-backed tests where applicable.

### Gates

- **Design gate:** D-01–D-14 remain approved design only. A–H remain at their classifications in §3 until valid evidence or explicit owner approval changes them.
- **Evidence gate:** Do not decide items marked Evidence Required or claim specialist acceptance without the requested evidence and authority.
- **Documentation gate:** This register does not authorize edits to the BM-05 specification or any other existing document. Further documentation changes require separate explicit authorization.
- **Implementation gate:** BM-05 implementation remains **BLOCKED** until A–H decision closure and separate implementation authorization are recorded. No schema, migration, database operation, test-data mutation, or deployment is authorized here.
- **Map acceptance gate:** BM-05 is not fully accepted until map-based Discovery requirements in §§78–79 are implemented and verified under separately authorized work.

## 11. Change History

| Version / date | Change | Authorization and status |
|---|---|---|
| 1.0 / 2026-10-18 | Initial creation of the A–H governance register, evidence requests, approval agenda, traceability, and gates. | Created under the explicit Phase 2A authorization limited to this single new Markdown file. No A–H decision or implementation was approved. |

Future changes require separate authorization. Record the exact scope, source evidence, and decision-history impact for each update. Never rewrite prior approval history to imply a decision that was not made.
