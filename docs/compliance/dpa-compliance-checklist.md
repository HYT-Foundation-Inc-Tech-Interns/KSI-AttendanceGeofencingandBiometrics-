# Philippine Data Privacy Act (RA 10173) Compliance Checklist
**Klassic Field Attendance System - Biometric Timekeeping**

> ⚠️ **LEGAL DISCLAIMER**: This checklist is for internal guidance only and does not constitute legal advice. Consult with a Data Protection Officer (DPO) and legal counsel before processing any biometric data.

## Executive Summary

Facial recognition data is classified as **sensitive personal information** under RA 10173. This system processes:
- ✅ Biometric templates (face embeddings) - **Sensitive**
- ✅ GPS coordinates tied to individuals - **Personal**
- ✅ Attendance records tied to payroll - **Personal**

**Compliance Status**: 🟡 In Progress (must be completed before production deployment)

---

## 1. Legal Basis for Processing Biometric Data

### ✅ Required Actions

- [ ] **Written Consent**: Obtain explicit, informed, written consent from each employee
  - Must be freely given (not coerced by employment requirement)
  - Must be specific to biometric timekeeping
  - Must be documented and retained
  
- [ ] **Privacy Notice**: Provide a comprehensive privacy notice covering:
  - [ ] What data is collected (face embeddings, GPS, attendance timestamps)
  - [ ] Purpose of collection (timekeeping, payroll calculation)
  - [ ] Legal basis (consent + legitimate interest in accurate payroll)
  - [ ] How long data is retained (see retention schedule below)
  - [ ] Who has access (HR, supervisors, payroll system)
  - [ ] Employee rights (access, correction, erasure, objection, portability)
  - [ ] Cross-border transfers (if using cloud face-matching APIs)
  - [ ] Contact info for DPO or responsible officer

- [ ] **Fallback Option**: Offer a non-biometric alternative for employees who object
  - Example: Supervisor-verified manual check-in
  - Document why the fallback is operationally reasonable

### 📄 Deliverables
- `docs/compliance/privacy-notice-employee.md`
- `docs/compliance/consent-form-template.docx`
- `docs/compliance/fallback-process.md`

---

## 2. Data Protection Officer (DPO)

### ✅ Required Actions

- [ ] **Designate a DPO**: Appoint a qualified Data Protection Officer
  - Name: _______________________
  - Contact: _____________________
  - Responsibilities documented
  
- [ ] **Register with NPC**: If Klassic's data processing volume exceeds NPC thresholds
  - Check current NPC registration guidelines at: https://privacy.gov.ph
  - File registration within prescribed period
  
- [ ] **DPO Training**: Ensure DPO is trained on:
  - RA 10173 requirements
  - Biometric data handling best practices
  - Incident response procedures

### 📄 Deliverables
- `docs/compliance/dpo-designation-letter.docx`
- `docs/compliance/npc-registration-status.md`

---

## 3. Data Retention and Deletion

### ✅ Required Actions

- [ ] **Define Retention Periods**:
  - **Face embeddings**: Delete within 30 days of employee offboarding (or immediately if consent withdrawn)
  - **Attendance records**: Retain per labor law requirements (typically 3-5 years for payroll records)
  - **Audit logs**: Retain 1 year minimum for security/compliance review
  
- [ ] **Implement Automated Deletion**:
  - [ ] Scheduled job to purge revoked biometric enrollments
  - [ ] Manual deletion process for employee requests (GDPR-style "right to erasure")
  - [ ] Separate retention for payroll vs. biometric data (can delete embeddings while keeping attendance history)
  
- [ ] **Document Retention Policy**:
  - Write policy explaining what, why, and for how long
  - Publish to employees
  - Review annually

### 📄 Deliverables
- `docs/compliance/data-retention-policy.md`
- `backend/src/jobs/biometric-cleanup.job.ts` (automated deletion job)

---

## 4. Access Control and Audit

### ✅ Required Actions

- [ ] **Role-Based Access Control (RBAC)**:
  - [ ] Only HR/Supervisors can enroll biometric data
  - [ ] Employees can view their own attendance records only
  - [ ] Admins can override, but overrides are logged
  - [ ] Service-to-service key required for payroll export
  
- [ ] **Audit Logging** (already in schema):
  - [ ] All check-ins/check-outs logged with timestamp, actor, action
  - [ ] Manual overrides logged with reason + HR user ID
  - [ ] Biometric enrollment/revocation logged
  - [ ] Payroll exports logged
  
- [ ] **Monthly Access Review**:
  - [ ] Review who accessed what data each month
  - [ ] Flag anomalies (bulk data export, unusual access patterns)
  - [ ] Document review in compliance log

### 📄 Deliverables
- `docs/compliance/rbac-matrix.md`
- `docs/compliance/access-review-template.xlsx`

---

## 5. Cross-Border Data Transfers

### ⚠️ CRITICAL: Review Face-Matching API Choice

- [ ] **If using a cloud face-matching API** (e.g., AWS Rekognition, Azure Face API):
  - [ ] Vendor is outside the Philippines → this is a **cross-border transfer**
  - [ ] Required actions:
    - [ ] Sign a Data Processing Agreement (DPA) with the vendor
    - [ ] Ensure vendor has adequate security measures (ISO 27001, SOC 2, etc.)
    - [ ] Verify vendor's data residency policy (where is data stored/processed?)
    - [ ] Include cross-border transfer disclosure in the privacy notice
    - [ ] Check if NPC approval is required (depends on transfer type and volume)
  
- [ ] **If using self-hosted face-matching** (e.g., InsightFace, ArcFace):
  - [ ] Confirm servers are in the Philippines or a whitelisted jurisdiction
  - [ ] No cross-border transfer disclosure needed (but still document this decision)

### 📄 Deliverables
- `docs/compliance/vendor-dpa-template.docx` (if using cloud API)
- `docs/compliance/data-residency-decision.md`

---

## 6. Security Safeguards (Technical)

### ✅ Required Actions (per RA 10173 IRR Rule VII)

- [ ] **Encryption**:
  - [x] TLS for data in transit (already required in architecture)
  - [x] Column-level encryption for face embeddings at rest (already in architecture)
  - [ ] Implement key rotation policy
  
- [ ] **Access Control**:
  - [x] JWT authentication (already in architecture)
  - [x] Row Level Security (RLS) in database (already in schema)
  - [ ] Multi-factor authentication (MFA) for HR/Admin roles (recommended, not yet implemented)
  
- [ ] **Logging and Monitoring**:
  - [x] Append-only audit log (already in schema)
  - [ ] Set up alerts for suspicious activity (e.g., bulk data export, repeated failed logins)
  - [ ] Centralized log collection (Sentry or similar)
  
- [ ] **Vulnerability Management**:
  - [ ] Automated dependency scanning (npm audit, Snyk) in CI/CD
  - [ ] Penetration test before production launch
  - [ ] Quarterly security reviews

### 📄 Deliverables
- `docs/compliance/security-controls.md`
- `docs/compliance/penetration-test-report.pdf` (post-Phase 7)

---

## 7. Incident Response Plan

### ✅ Required Actions

- [ ] **Define "Data Breach"**:
  - Unauthorized access to biometric templates
  - Accidental exposure of attendance data
  - Loss of device with unencrypted embeddings
  
- [ ] **Breach Notification Procedure**:
  - [ ] Detect breach within 24 hours (monitoring + alerting)
  - [ ] Notify NPC within 72 hours (per RA 10173 requirements)
  - [ ] Notify affected employees if breach poses risk to their rights/freedoms
  - [ ] Document incident, root cause, and remediation
  
- [ ] **Incident Response Team**:
  - DPO (lead)
  - IT/Security lead
  - Legal counsel
  - HR representative

### 📄 Deliverables
- `docs/compliance/incident-response-plan.md`
- `docs/compliance/breach-notification-template.docx`

---

## 8. Employee Rights Management

### ✅ Required Actions

Employees have the following rights under RA 10173:

- [ ] **Right to Access**: Provide employee's own data within 30 days of request
  - [ ] Implement `/employees/me/data-export` endpoint (not in current spec)
  
- [ ] **Right to Correction**: Allow updates to incorrect personal info
  - [ ] Already available via employee profile updates
  
- [ ] **Right to Erasure**: Delete biometric data upon request or offboarding
  - [ ] Implement `/employees/{id}/revoke-biometric` endpoint
  - [ ] Clarify: attendance history may be retained per labor law (separate from biometric template)
  
- [ ] **Right to Object**: Offer non-biometric fallback
  - [ ] Document fallback procedure
  
- [ ] **Right to Data Portability**: Provide data in machine-readable format
  - [ ] Export attendance records as JSON/CSV

### 📄 Deliverables
- `docs/compliance/employee-rights-procedure.md`
- `backend/src/controllers/data-subject-requests.controller.ts` (to be built in Phase 7)

---

## 9. Vendor and Third-Party Management

### ✅ Required Actions

- [ ] **Identify all third parties** that touch personal data:
  - Cloud hosting provider (Render/Railway/AWS)
  - Supabase (database)
  - Face-matching API vendor (if cloud-based)
  - Sentry (error tracking)
  - Any analytics services
  
- [ ] **For each vendor**:
  - [ ] Sign Data Processing Agreement (DPA)
  - [ ] Verify their security certifications (ISO 27001, SOC 2, etc.)
  - [ ] Document in vendor registry
  - [ ] Review annually

### 📄 Deliverables
- `docs/compliance/vendor-registry.xlsx`
- `docs/compliance/vendor-dpa-signed/` (folder with signed DPAs)

---

## 10. Training and Awareness

### ✅ Required Actions

- [ ] **Train all personnel** who handle biometric data:
  - HR staff (enrollment process)
  - IT/DevOps (system administration)
  - Supervisors (manual overrides, exception handling)
  
- [ ] **Training topics**:
  - RA 10173 overview
  - Handling sensitive personal information
  - Incident reporting
  - Employee privacy rights
  
- [ ] **Annual refresher training**

### 📄 Deliverables
- `docs/compliance/training-slides.pptx`
- `docs/compliance/training-attendance-log.xlsx`

---

## 11. NPC Biometric Guidelines (Upcoming)

### ⚠️ MONITORING REQUIREMENT

- [ ] **Watch for NPC's dedicated biometric guidelines**:
  - The National Privacy Commission is developing specific rules for biometric data processing
  - Current status: Draft stage (as of September 2026 - **check NPC website for updates**)
  - URL: https://privacy.gov.ph/regulations-and-issuances/
  
- [ ] **Action**: Review and update this checklist once NPC biometric guidelines are finalized

---

## 12. Compliance Sign-Off

### ✅ Pre-Production Gate

**Before deploying to production, obtain written sign-off from:**

- [ ] **Data Protection Officer**: Confirms all DPA requirements met
  - Signed by: _______________ Date: ___________
  
- [ ] **Legal Counsel**: Confirms legal basis and documentation adequate
  - Signed by: _______________ Date: ___________
  
- [ ] **HR Director**: Confirms employee communication and consent collection
  - Signed by: _______________ Date: ___________
  
- [ ] **IT Security Lead**: Confirms technical safeguards implemented
  - Signed by: _______________ Date: ___________

### 📄 Deliverables
- `docs/compliance/production-readiness-signoff.pdf`

---

## Summary Status Dashboard

| Requirement | Status | Owner | Due Date |
|-------------|--------|-------|----------|
| Privacy Notice | 🔴 Not Started | Legal/HR | Before enrollment |
| Consent Forms | 🔴 Not Started | HR | Before enrollment |
| DPO Designation | 🔴 Not Started | Management | Week 1 |
| NPC Registration | 🔴 Not Started | DPO | After DPO designation |
| Data Retention Policy | 🔴 Not Started | DPO + IT | Phase 7 |
| RBAC Implementation | 🟢 In Progress | Backend Team | Phase 1 |
| Audit Logging | 🟢 In Progress | Backend Team | Phase 1 |
| Encryption (TLS + at-rest) | 🟢 In Progress | Backend Team | Phase 1 |
| Vendor DPAs | 🔴 Not Started | DPO | Phase 7 |
| Incident Response Plan | 🔴 Not Started | DPO + IT Security | Phase 7 |
| Penetration Test | 🔴 Not Started | IT Security | Phase 7 |
| Training Program | 🔴 Not Started | HR | Before rollout |
| Employee Rights Endpoints | 🔴 Not Started | Backend Team | Phase 7 |
| Production Sign-Off | 🔴 Not Started | All stakeholders | Phase 9 |

---

## Next Steps

1. **Immediate (Phase 0)**: 
   - Assign a DPO
   - Draft privacy notice and consent form
   - Start vendor due diligence

2. **Before Pilot (Phase 9)**:
   - Complete all 🔴 items above
   - Conduct penetration test
   - Obtain sign-offs

3. **Post-Launch (Phase 10)**:
   - Monthly access reviews
   - Quarterly security audits
   - Annual policy reviews
   - Monitor NPC for new biometric guidelines

---

**Document Version**: 1.0  
**Last Updated**: September 11, 2026  
**Next Review**: Before Phase 7 (Security Hardening)  
**Owner**: Data Protection Officer (TBD)
