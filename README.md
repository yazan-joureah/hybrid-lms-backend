# Hybrid Learning Management System (Hybrid LMS) — Backend API

## Executive Summary

This document presents the comprehensive technical specification and implementation documentation for the **Hybrid Learning Management System (Hybrid LMS) Backend**, developed as part of the BPR601 graduation project for Spring 2025 academic semester at Syrian Virtual University (SVU). This system represents a modern, security-first approach to educational technology, combining synchronous and asynchronous learning modalities within a unified platform architecture.

The backend API serves as the foundational infrastructure layer for a comprehensive learning ecosystem, implementing enterprise-grade security patterns, real-time communication protocols, and distributed system design principles. This implementation demonstrates adherence to current software engineering best practices, including OWASP security guidelines, RESTful API design patterns, microservices-oriented architecture, and DevSecOps methodologies.

**Project Metadata:**
- **Project Title:** Hybrid Learning Management System — Backend Infrastructure
- **Course Code:** BPR601 (Bachelor Project)
- **Academic Term:** Spring 2025 (S25)
- **Institution:** Syrian Virtual University (SVU)
- **Module Lead:** Yazan Joureah — Student ID: 174681
- **Role:** Backend Engineering & Cybersecurity Lead
- **Version:** 0.1.0 (Development Phase)
- **Repository Type:** Monolithic Backend API
- **License:** UNLICENSED (Academic Project)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Research Context & Academic Justification](#research-context--academic-justification)
3. [System Architecture & Design Principles](#system-architecture--design-principles)
4. [Technology Stack & Rationale](#technology-stack--rationale)
5. [Core Functional Requirements](#core-functional-requirements)
6. [Security Architecture & Implementation](#security-architecture--implementation)
7. [Software Engineering Standards & Compliance](#software-engineering-standards--compliance)
8. [Development Environment Setup](#development-environment-setup)
9. [Testing Methodology & Quality Assurance](#testing-methodology--quality-assurance)
10. [API Documentation & Interface Specifications](#api-documentation--interface-specifications)
11. [Database Design & Data Modeling](#database-design--data-modeling)
12. [Deployment Architecture & Operations](#deployment-architecture--operations)
13. [Performance Optimization & Scalability](#performance-optimization--scalability)
14. [DevSecOps Pipeline & Continuous Integration](#devsecops-pipeline--continuous-integration)
15. [Project Management & Development Workflow](#project-management--development-workflow)
16. [Future Enhancements & Research Directions](#future-enhancements--research-directions)
17. [References & Academic Sources](#references--academic-sources)
18. [Appendices](#appendices)

---

## Research Context & Academic Justification

### 1.1 Problem Statement

Traditional Learning Management Systems (LMS) predominantly focus on either fully synchronous (live, real-time) or asynchronous (self-paced) learning modalities. The COVID-19 pandemic (2020-2023) accelerated digital transformation in education, revealing critical gaps in existing educational technology infrastructure:

1. **Modality Rigidity:** Most platforms lack seamless integration between synchronous and asynchronous learning experiences
2. **Security Deficiencies:** Educational platforms have become high-value targets for cyberattacks, yet many implementations lack enterprise-grade security measures
3. **Identity Verification:** The shift to remote learning introduced challenges in academic integrity and identity verification
4. **Financial Integration:** Limited support for commercial course offerings and secure payment processing
5. **Accessibility Barriers:** Insufficient compliance with accessibility standards (WCAG 2.1 AA)
6. **Scalability Limitations:** Legacy architectures struggle with concurrent user loads during peak academic periods

### 1.2 Research Objectives

This project addresses the identified gaps through the following research and implementation objectives:

**Primary Objectives:**
1. Design and implement a hybrid learning platform that seamlessly integrates synchronous and asynchronous learning modalities
2. Develop a security-first architecture compliant with OWASP Top 10, NIST cybersecurity frameworks, and GDPR data protection requirements
3. Implement enterprise-grade authentication mechanisms including Multi-Factor Authentication (MFA) and OAuth 2.0 integration
4. Create a scalable, maintainable codebase following SOLID principles and clean architecture patterns

**Secondary Objectives:**
1. Integrate real-time communication capabilities using WebSocket technology
2. Implement blockchain-inspired digital credential verification system
3. Develop comprehensive audit logging for compliance and forensics
4. Create an extensible plugin architecture for future feature additions

### 1.3 Academic Contribution

This implementation contributes to the academic body of knowledge in the following areas:

- **Software Engineering:** Demonstrates practical application of MVCS (Model-View-Controller-Service) architecture in a Node.js ecosystem
- **Cybersecurity:** Implements defense-in-depth security strategy with multiple overlapping security controls
- **Educational Technology:** Provides an open-source reference implementation for hybrid learning systems
- **DevSecOps:** Showcases shift-left security principles with automated security scanning in CI/CD pipeline

### 1.4 Literature Review & Related Work

The design of this system draws upon established research in educational technology, distributed systems, and cybersecurity:

**Educational Technology Frameworks:**
- Garrison's Community of Inquiry (CoI) framework for online learning design
- Bloom's Taxonomy for competency-based assessment design
- Universal Design for Learning (UDL) principles for accessibility

**Software Architecture Patterns:**
- Richardson, Chris. *Microservices Patterns*. Manning Publications, 2018
- Martin, Robert C. *Clean Architecture*. Prentice Hall, 2017
- Evans, Eric. *Domain-Driven Design*. Addison-Wesley, 2003

**Security Standards:**
- OWASP Top 10 Web Application Security Risks (2021)
- NIST SP 800-63B: Digital Identity Guidelines
- NIST SP 800-53: Security and Privacy Controls
- CIS Controls v8 for secure system configuration

---

## System Architecture & Design Principles

### 2.1 Architectural Overview

The Hybrid LMS Backend implements a **layered monolithic architecture** with clear separation of concerns, designed for future microservices decomposition. The architecture follows the **MVCS (Model-View-Controller-Service)** pattern, an evolution of traditional MVC that separates business logic from HTTP concerns.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (Web App, Mobile App, Third-party Integrations)                │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS/WSS
┌────────────────────────▼────────────────────────────────────────┐
│                    API Gateway Layer                             │
│  • Rate Limiting  • CORS  • CSRF Protection  • Helmet.js        │
│  • Request Validation  • Authentication Middleware               │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Controller Layer                              │
│  • HTTP Request/Response handling                                │
│  • Input validation (Zod schemas)                                │
│  • No business logic — delegates to Service Layer                │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                     Service Layer                                │
│  • Business logic implementation                                 │
│  • Transaction management                                        │
│  • Cross-cutting concerns (logging, audit)                       │
│  • Delegates data access to Model Layer                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                      Model Layer                                 │
│  • Mongoose schemas and models (30+ entities)                    │
│  • Data validation and business rules                            │
│  • Database abstraction                                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   Data Persistence Layer                         │
│  • MongoDB (Primary datastore)                                   │
│  • Redis (Session store, cache, rate limiting)                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Design Principles

This implementation adheres to industry-standard software engineering principles:

#### SOLID Principles
1. **Single Responsibility Principle (SRP):** Each module has one reason to change
   - Controllers handle only HTTP concerns
   - Services contain only business logic
   - Models handle only data validation and persistence

2. **Open/Closed Principle (OCP):** Open for extension, closed for modification
   - Middleware pipeline architecture allows adding new middleware without modifying existing code
   - Strategy pattern for multiple authentication providers (JWT, OAuth, MFA)

3. **Liskov Substitution Principle (LSP):** 
   - All authentication strategies implement consistent interfaces
   - Multiple payment gateways can be swapped without affecting business logic

4. **Interface Segregation Principle (ISP):**
   - Role-based route protection ensures clients receive only relevant endpoints
   - Separate admin and user interfaces

5. **Dependency Inversion Principle (DIP):**
   - Services depend on abstractions (Mongoose models) not concrete implementations
   - Configuration injection for environment-specific behavior

#### Additional Principles
- **DRY (Don't Repeat Yourself):** Shared utilities and middleware prevent code duplication
- **KISS (Keep It Simple, Stupid):** Favor readability and maintainability over premature optimization
- **YAGNI (You Aren't Gonna Need It):** Features implemented only when required, not speculatively
- **Separation of Concerns:** Clear boundaries between authentication, authorization, business logic, and data access
- **Fail-Fast Principle:** Input validation at entry points prevents invalid state propagation

### 2.3 Architectural Patterns

**Patterns Implemented:**

1. **Repository Pattern:** Mongoose models abstract database operations
2. **Factory Pattern:** Token generation, email templates, certificate creation
3. **Strategy Pattern:** Multiple authentication mechanisms (local, OAuth, MFA)
4. **Middleware Chain Pattern:** Express middleware for cross-cutting concerns
5. **Observer Pattern:** Socket.IO event-driven architecture for real-time features
6. **Singleton Pattern:** Database connections, logger instances
7. **Dependency Injection:** Configuration and service injection for testability

### 2.4 Scalability Considerations

**Horizontal Scalability:**
- Stateless API design (JWT tokens, not server sessions)
- Redis for shared session state across multiple instances
- Socket.IO with Redis adapter for multi-server WebSocket support

**Vertical Scalability:**
- Node.js cluster mode support
- Database indexing strategy for query optimization
- Connection pooling for MongoDB and Redis

**Caching Strategy:**
- Redis caching for frequently accessed data
- HTTP cache headers for static content
- Query result caching with TTL

---

## Technology Stack & Rationale


### 3.1 Core Technology Stack

The technology selection process prioritized the following criteria:
- Open-source licensing (cost-free, academic access, community support)
- Production readiness and enterprise adoption
- Active maintenance and security patch history
- Comprehensive documentation and community resources
- Performance characteristics suitable for educational workloads
- Compatibility with modern DevSecOps practices

| Component Category | Technology | Version | License | Rationale |
|-------------------|------------|---------|---------|-----------|
| **Runtime Environment** | Node.js | 22.x LTS | MIT | Event-driven, non-blocking I/O ideal for real-time applications; V8 engine performance; extensive package ecosystem |
| **Web Framework** | Express.js | 4.19+ | MIT | Minimalist, unopinionated framework; industry standard; excellent middleware ecosystem; high-performance routing |
| **Primary Database** | MongoDB | 8.x | SSPL | Document-oriented model suits flexible course content; horizontal scalability; rich query language; ACID transactions |
| **Cache & Session Store** | Redis | 7.x | BSD-3-Clause | In-memory performance; pub/sub for WebSockets; atomic operations; persistence options |
| **Real-time Communication** | Socket.IO | 4.7+ | MIT | WebSocket abstraction; automatic fallbacks; room/namespace architecture; Redis adapter for clustering |
| **Database GUI (Dev)** | mongo-express | Latest | MIT | Web-based MongoDB admin interface; useful for development and debugging; **never deployed to production** |
| **Password Hashing** | @node-rs/argon2 | 2.0+ | MIT | Argon2id algorithm (winner of Password Hashing Competition); NIST SP 800-63B compliant; resistance to GPU attacks |
| **JWT Implementation** | jsonwebtoken | 9.0+ | MIT | RFC 7519 compliant; HS256/RS256 support; industry standard |
| **TOTP (MFA)** | otplib | 13.4+ | MIT | RFC 6238 compliant; QR code generation; backup code support |
| **OAuth 2.0** | google-auth-library | 10.9+ | Apache-2.0 | Official Google SDK; OIDC support; automatic token refresh |
| **Payment Processing** | Stripe SDK | 22.3+ | MIT (SDK) | PCI DSS compliant; webhook support; comprehensive API; strong fraud detection |
| **File Upload** | Multer | 2.2+ | MIT | Multipart/form-data handling; flexible storage engines; size and type restrictions |
| **Schema Validation** | Zod | 3.23+ | MIT | TypeScript-first schema validation; type inference; composable schemas; runtime type safety |
| **Testing Framework** | Jest | 29.7+ | MIT | Zero-config; snapshot testing; code coverage; mocking capabilities |
| **API Testing** | Supertest | 7.0+ | MIT | High-level HTTP assertions; Express integration; readable test syntax |
| **Property-Based Testing** | fast-check | 3.19+ | MIT | Generative testing; edge case discovery; specification-based testing |
| **Logging** | Winston | 3.13+ | MIT | Multiple transports; log levels; JSON formatting; production-ready |
| **Code Quality** | ESLint | 8.57+ | MIT | Pluggable linting; security rules (eslint-plugin-security); auto-fix capabilities |
| **Code Formatting** | Prettier | 3.3+ | MIT | Opinionated formatting; language support; editor integration |
| **Git Hooks** | Husky | 9.1+ | MIT | Pre-commit/push hooks; enforces quality gates |
| **Secret Scanning** | Gitleaks | Latest | MIT | Prevents secret leakage; regex + entropy detection; pre-commit integration |

### 3.2 Technology Selection Justification

#### Why Node.js?
- **Non-blocking I/O:** Ideal for I/O-heavy educational applications (file uploads, video streaming, real-time chat)
- **JavaScript Everywhere:** Enables full-stack JavaScript development, reducing cognitive load
- **NPM Ecosystem:** 2+ million packages provide solutions for common problems
- **Industry Adoption:** Used by Netflix, LinkedIn, Uber demonstrating enterprise scalability
- **Academic Resources:** Extensive tutorials, documentation, and learning materials

#### Why MongoDB?
- **Flexible Schema:** Course content structures vary significantly; document model accommodates this naturally
- **Rich Query Language:** Aggregation framework supports complex analytical queries
- **ACID Transactions:** Multi-document transactions ensure data consistency (introduced in v4.0, matured in v8.x)
- **Horizontal Scalability:** Sharding supports future growth to millions of users
- **JSON-Native:** Seamless integration with JavaScript/Node.js ecosystem

#### Why Redis?
- **Sub-millisecond Latency:** Critical for session validation on every request
- **Atomic Operations:** Prevents race conditions in rate limiting
- **Pub/Sub:** Enables real-time features across multiple server instances
- **Versatile Data Structures:** Lists, sets, sorted sets, hashes support various caching patterns
- **Persistence Options:** RDB/AOF for durability when needed

#### Why Argon2id?
- **NIST Recommended:** NIST SP 800-63B explicitly recommends Argon2
- **Memory-Hard:** Resistant to GPU/ASIC attacks (critical in 2025 threat landscape)
- **Configurable:** Adjustable time/memory parameters allow tuning for hardware
- **Argon2id Variant:** Hybrid mode provides resistance to both side-channel and time-memory trade-off attacks

#### Why Socket.IO over Raw WebSockets?
- **Automatic Fallbacks:** Degrades gracefully to long-polling when WebSockets unavailable
- **Room Architecture:** Simplifies multi-user session management
- **Redis Adapter:** Enables WebSocket load balancing across multiple servers
- **Reconnection Logic:** Built-in reconnection with exponential backoff
- **Binary Support:** Efficient for file transfers during live sessions

### 3.3 Development Dependencies

| Tool | Purpose | Justification |
|------|---------|---------------|
| **Babel** | JavaScript transpilation | Enables modern JS features while maintaining Node.js compatibility |
| **Nodemon** | Development auto-reload | Improves developer productivity during active development |
| **ESLint Security Plugin** | Security linting | Detects insecure patterns (eval, RegEx DoS, SQL injection patterns) |
| **Lint-Staged** | Staged file linting | Reduces CI overhead by linting only changed files |
| **Supertest** | HTTP assertion library | Simplified API endpoint testing with readable syntax |
| **fast-check** | Property-based testing | Discovers edge cases missed by example-based tests |

### 3.4 External Service Integrations

| Service | Purpose | Integration Method |
|---------|---------|-------------------|
| **Google OAuth 2.0** | Social authentication | Official Google Auth Library SDK |
| **Stripe** | Payment processing | Official Stripe Node.js SDK + Webhooks |
| **Gmail SMTP** | Email delivery | OAuth2 authenticated SMTP |
| **ClamAV (Optional)** | Malware scanning | Unix socket / TCP connection |

**Note:** All external service credentials are stored as environment variables, never committed to version control, and rotated regularly.

---

## Core Functional Requirements


This section details the functional requirements implemented in the system, organized by module and aligned with IEEE 830-1998 Software Requirements Specification standards.

### 4.1 Authentication & Identity Management (AUTH Module)

**Requirement ID:** FR-AUTH-001 to FR-AUTH-015

**User Registration (FR-AUTH-001)**
- **Description:** System shall support user registration with email verification
- **Inputs:** Email, password, first name, last name, date of birth, role
- **Process:**
  1. Validate email format and uniqueness
  2. Enforce password complexity requirements (min 8 chars, uppercase, lowercase, number, special char)
  3. Hash password using Argon2id with salt
  4. Generate email verification token (JWT, 24-hour expiry)
  5. Send verification email via Gmail SMTP
  6. Store user in pending state until verification
- **Outputs:** User account created, verification email sent
- **Security:** Password never stored in plaintext; email token single-use; rate limit: 3 registrations per IP per hour

**Parental Consent for Minors (FR-AUTH-002)**
- **Description:** Users under 18 require parental consent (COPPA compliance)
- **Process:**
  1. System calculates age from date of birth
  2. If age < 18, request parent/guardian email
  3. Generate parental consent token (7-day expiry)
  4. Send consent request to guardian email
  5. Account activated only after guardian approval
- **Regulatory Compliance:** COPPA (Children's Online Privacy Protection Act), GDPR Article 8

**Multi-Factor Authentication (FR-AUTH-003)**
- **Description:** Optional TOTP-based MFA for enhanced account security
- **Algorithm:** RFC 6238 TOTP (Time-based One-Time Password)
- **Implementation:**
  1. Generate secret key (32-character base32)
  2. Create QR code for authenticator app enrollment
  3. Generate 10 single-use backup codes (encrypted with AES-256-GCM)
  4. Require TOTP code on login when enabled
  5. Support backup code fallback
- **Security:** Secret key encrypted at rest; backup codes hashed; rate limit: 5 failed MFA attempts trigger 15-minute lockout

**OAuth 2.0 Social Authentication (FR-AUTH-004)**
- **Description:** Login using Google account (OAuth 2.0 / OpenID Connect)
- **Flow:**
  1. Client redirects to Google authorization endpoint
  2. User authenticates with Google
  3. Google redirects back with authorization code
  4. Server exchanges code for access token
  5. Retrieve user profile from Google
  6. Create or link local account
  7. Issue JWT access/refresh tokens
- **Standards:** RFC 6749 (OAuth 2.0), OpenID Connect Core 1.0
- **Security:** CSRF protection via state parameter; PKCE for mobile clients

**JWT Token Management (FR-AUTH-005)**
- **Description:** Stateless authentication using JSON Web Tokens
- **Token Types:**
  - **Access Token:** Short-lived (15 minutes), contains user ID and role
  - **Refresh Token:** Long-lived (7 days), stored in httpOnly cookie
- **Algorithm:** HS256 (HMAC-SHA256)
- **Claims:** `sub` (user ID), `role`, `iat`, `exp`, `jti` (JWT ID)
- **Security:** Refresh tokens stored in Redis with rotation; automatic revocation on logout/password change

**Password Reset (FR-AUTH-006)**
- **Description:** Secure password reset via email
- **Process:**
  1. User requests reset with email
  2. Generate single-use reset token (1-hour expiry)
  3. Send email with reset link
  4. User submits new password with token
  5. Validate token, update password, revoke all sessions
- **Security:** Token expires after use; rate limit: 3 reset requests per email per hour

**Account Deletion & Recovery (FR-AUTH-007)**
- **Description:** Soft deletion with 30-day recovery window (GDPR Article 17)
- **Process:**
  1. User requests account deletion
  2. Account marked as `pendingDeletion`, login disabled
  3. 30-day grace period for recovery
  4. After 30 days, permanent deletion job anonymizes/deletes data
  5. User can request recovery within grace period
- **Compliance:** GDPR Right to Erasure (Article 17), Right to Rectification (Article 16)

### 4.2 Course Management (COURSE Module)

**Requirement ID:** FR-COURSE-001 to FR-COURSE-020

**Course Creation & Publishing (FR-COURSE-001)**
- **Actor:** Instructor (role: instructor)
- **Description:** Create structured course with units and lessons
- **Data Model:**
  ```
  Course
  ├── Metadata (title, description, category, level, language)
  ├── Pricing (free/paid, price, currency)
  ├── Cover Image
  ├── Units[]
  │   ├── Unit Metadata (title, order)
  │   └── Lessons[]
  │       ├── Lesson Type (video, document, quiz, assignment)
  │       ├── Content (URL, file path, embed code)
  │       └── Duration
  └── Enrollment Settings (open/invite-only, capacity)
  ```
- **Workflow:**
  1. Draft → Review → Published
  2. Admin approval required before publication
  3. Versioning support for content updates

**Content Upload & Management (FR-COURSE-002)**
- **Supported Formats:**
  - Videos: MP4, WebM (max 500MB)
  - Documents: PDF, DOCX, PPTX (max 25MB)
  - Images: JPEG, PNG, GIF, WebP (max 5MB)
  - Archives: ZIP (max 100MB)
- **Processing:**
  1. File type validation (magic number verification, not extension-based)
  2. Virus scanning with ClamAV (if configured)
  3. Upload to cloud storage or local filesystem
  4. Generate signed URLs for private content
- **Security:** Content access control; pre-signed URLs with expiry; malware scanning

**Student Enrollment (FR-COURSE-003)**
- **Types:**
  - Free enrollment (immediate)
  - Paid enrollment (Stripe payment required)
  - Invite-only (instructor approval)
- **Process:**
  1. Student requests enrollment
  2. Payment processing (if paid course)
  3. Enrollment record created
  4. Enrollment confirmation email
  4. Access granted to course materials

**Progress Tracking (FR-COURSE-004)**
- **Metrics:**
  - Lessons completed (%)
  - Time spent per lesson
  - Quiz scores
  - Assignment submissions
  - Overall course completion (%)
- **Implementation:**
  - Event-driven progress updates
  - Aggregated progress view for instructors
  - Student dashboard with progress visualization

**Course Reviews & Ratings (FR-COURSE-005)**
- **Features:**
  - 5-star rating system
  - Text reviews
  - Review moderation (flagging, admin review)
  - Average rating calculation
  - Review helpfulness voting
- **Rules:** Only enrolled students can review; one review per student per course

### 4.3 Live Sessions (LIVE Module)

**Requirement ID:** FR-LIVE-001 to FR-LIVE-010

**Real-Time Session Management (FR-LIVE-001)**
- **Technology:** Socket.IO (WebSocket with fallback to long-polling)
- **Features:**
  - Session scheduling with calendar integration
  - Participant management (admit, remove, mute)
  - Screen sharing capability
  - Live chat with moderation
  - Attendance tracking
  - Session recording (optional)
- **Capacity:** Up to 500 concurrent participants per session
- **Architecture:**
  ```
  Client ←→ Socket.IO Server ←→ Redis Pub/Sub ←→ Socket.IO Server ←→ Client
  (Room-based isolation, Redis adapter for horizontal scaling)
  ```

**Live Chat & Moderation (FR-LIVE-002)**
- **Features:**
  - Real-time text chat
  - Emoji reactions
  - Message deletion (by author or moderator)
  - User muting
  - Chat history persistence
- **Security:** Rate limiting (5 messages/10 seconds); profanity filter; link safety check

**Attendance Tracking (FR-LIVE-003)**
- **Mechanism:**
  - Join/leave timestamps recorded
  - Heartbeat pings every 30 seconds
  - Duration calculation
  - Attendance threshold configurable (e.g., 75% of session time)
- **Reporting:** Exportable attendance reports (CSV, PDF)

### 4.4 Assessments & Quizzes (QUIZ Module)

**Requirement ID:** FR-QUIZ-001 to FR-QUIZ-008

**Quiz Creation (FR-QUIZ-001)**
- **Question Types:**
  - Multiple Choice (single correct answer)
  - Multiple Answer (multiple correct answers)
  - True/False
  - Short Answer (manual grading)
  - Essay (manual grading)
- **Configuration:**
  - Time limit
  - Attempts allowed
  - Passing score
  - Randomize question order
  - Randomize answer order
  - Show correct answers (after submission/after passing/never)

**Automated Grading (FR-QUIZ-002)**
- **Process:**
  1. Student submits answers
  2. System compares with correct answers
  3. Calculate score
  4. Record attempt in database
  5. Update progress tracker
  6. Send notification with results
- **Accuracy:** Deterministic grading for objective questions; manual review queue for subjective questions

**Quiz Attempts & Retakes (FR-QUIZ-003)**
- **Rules:**
  - Configurable maximum attempts
  - Cooldown period between attempts
  - Best score or average score (configurable)
  - Detailed feedback per attempt
- **Anti-Cheating:** Randomization; time limits; browser lockdown (future enhancement)

### 4.5 Peer Review System (PEER Module)

**Requirement ID:** FR-PEER-001 to FR-PEER-007

**Assignment Distribution (FR-PEER-001)**
- **Algorithm:** Configurable assignment strategy
  - Random: Each submission assigned to N random peers
  - Round-robin: Balanced distribution
  - Skill-based: Match reviewers by competency (future)
- **Anonymity:** Optional anonymous peer review to reduce bias
- **Calibration:** Instructor reviews sample submissions; system calibrates peer scores against instructor baseline

**Review Rubrics (FR-PEER-002)**
- **Structure:**
  - Criteria-based scoring (e.g., "Clarity: 1-5 stars")
  - Weighted criteria
  - Text feedback required
  - Minimum word count for feedback
- **Quality Control:** Flagging system for low-quality reviews; instructor spot-checking

**Grade Aggregation (FR-PEER-003)**
- **Methods:**
  - Mean score
  - Median score (robust to outliers)
  - Weighted by reviewer reputation
  - Instructor-adjusted (instructor can override)

### 4.6 Payment Processing (PAYMENT Module)

**Requirement ID:** FR-PAY-001 to FR-PAY-006

**Stripe Integration (FR-PAY-001)**
- **Supported Payment Methods:**
  - Credit/Debit Cards (Visa, Mastercard, Amex)
  - Digital Wallets (Apple Pay, Google Pay)
  - Bank Transfers (ACH, SEPA)
- **Process:**
  1. Create Stripe Checkout Session
  2. Redirect user to Stripe-hosted payment page
  3. User completes payment
  4. Stripe webhook notifies server
  5. Verify webhook signature (HMAC)
  6. Activate course enrollment
  7. Issue invoice
- **Security:** PCI DSS Level 1 compliant (Stripe handles card data); webhook signature verification prevents replay attacks

**Refund Management (FR-PAY-002)**
- **Policy:**
  - 14-day full refund period
  - Partial refunds after 14 days (discretionary)
  - Automatic refund processing via Stripe API
- **Process:**
  1. Student requests refund (with reason)
  2. System checks eligibility (time, usage)
  3. Admin reviews request
  4. Approved refunds processed via Stripe
  5. Course access revoked

**Invoicing (FR-PAY-003)**
- **Features:**
  - PDF invoice generation
  - Tax calculation (configurable rates)
  - Invoice numbering (sequential, unique)
  - Email delivery
  - Instructor payout calculation (platform fee deduction)

### 4.7 Know Your Customer (KYC) Module

**Requirement ID:** FR-KYC-001 to FR-KYC-005

**Identity Verification (FR-KYC-001)**
- **Purpose:** Verify instructor identity before allowing course monetization
- **Required Documents:**
  - Government-issued ID (passport, driver's license, national ID)
  - Proof of address (utility bill, bank statement)
  - Selfie with ID (liveness check)
- **Process:**
  1. Instructor uploads documents
  2. System validates file types and quality
  3. Admin reviews documents
  4. Approve/reject with feedback
  5. On approval, enable monetization features
- **Compliance:** AML (Anti-Money Laundering), KYC regulations for financial platforms

**Document Storage (FR-KYC-002)**
- **Security:**
  - Encrypted at rest (AES-256)
  - Access logging (audit trail)
  - Automatic deletion after verification period (compliance with data minimization)
  - Restricted access (admin only)

### 4.8 Digital Certificates (CERT Module)

**Requirement ID:** FR-CERT-001 to FR-CERT-004

**Certificate Issuance (FR-CERT-001)**
- **Trigger:** Course completion (100% progress + passing grade)
- **Certificate Data:**
  - Student name
  - Course title
  - Completion date
  - Unique certificate ID (UUID)
  - Issuer signature (Ed25519 digital signature)
- **Format:** PDF with embedded QR code for verification

**Digital Signature (FR-CERT-002)**
- **Algorithm:** Ed25519 (EdDSA)
- **Process:**
  1. Generate certificate payload (JSON)
  2. Hash payload (SHA-256)
  3. Sign hash with private key
  4. Embed signature in certificate
- **Verification:**
  1. Extract signature from certificate
  2. Recalculate payload hash
  3. Verify signature with public key
  4. Confirm certificate ID in database (revocation check)

**Blockchain-Inspired Verification (FR-CERT-003)**
- **Concept:** Certificates anchored to immutable ledger (future blockchain integration planned)
- **Current Implementation:**
  - Certificate hash stored in database with timestamp
  - Public verification API (no authentication required)
  - Certificate ID + hash verification prevents tampering

### 4.9 Attendance Tracking (ATTENDANCE Module)

**Requirement ID:** FR-ATT-001 to FR-ATT-004

**Automated Attendance (FR-ATT-001)**
- **Methods:**
  - Live session attendance (Socket.IO connection tracking)
  - Lesson completion tracking (async content)
  - Geolocation check-in (optional, for hybrid courses)
  - QR code scanning (for in-person sessions)
- **Data Captured:**
  - Timestamp (join/leave)
  - Duration
  - IP address (for audit)
  - Geolocation (if permitted)

**Attendance Reports (FR-ATT-002)**
- **Formats:** CSV, PDF, Excel
- **Aggregations:**
  - Per student (across all sessions)
  - Per session (all students)
  - Per course (overall attendance rate)
- **Visualizations:** Charts, heatmaps, trend analysis

### 4.10 Administrative Functions (ADMIN Module)

**Requirement ID:** FR-ADMIN-001 to FR-ADMIN-010

**User Management (FR-ADMIN-001)**
- **Capabilities:**
  - View all users (paginated, searchable, filterable)
  - Update user roles
  - Suspend/unsuspend accounts
  - View user activity logs
  - Force password reset
  - Delete accounts (with confirmation)

**Audit Logging (FR-ADMIN-002)**
- **Events Logged:**
  - Authentication events (login, logout, failed attempts, password changes)
  - Authorization events (permission denied, role changes)
  - Data modifications (create, update, delete)
  - Payment events (purchases, refunds)
  - Administrative actions (user suspension, content moderation)
- **Log Format:** Structured JSON logs with timestamp, actor, action, resource, IP, user agent
- **Retention:** 90 days in hot storage, 1 year in cold storage (compressed)

**System Health Monitoring (FR-ADMIN-003)**
- **Metrics:**
  - API response times (p50, p95, p99)
  - Error rates (4xx, 5xx)
  - Database query performance
  - Redis cache hit rate
  - Active WebSocket connections
  - Server resource usage (CPU, memory, disk)
- **Alerting:** Email/Slack notifications for critical events (downtime, high error rate, security incidents)

**Content Moderation (FR-ADMIN-004)**
- **Moderation Queue:**
  - Flagged course content
  - Reported reviews
  - Flagged chat messages
  - Suspicious user behavior
- **Actions:** Approve, reject, request changes, ban user

---

## Security Architecture & Implementation

### المتطلبات
- Node.js ≥ 22
- Docker Desktop (لتشغيل MongoDB و Redis محلياً)
- ClamAV (اختياري — لفحص الملفات من البرمجيات الخبيثة)

### خطوات التشغيل

```bash
# 1. تثبيت الحزم
npm install

# 2. نسخ ملف البيئة وتعديله
cp .env.example .env
# املأ المتغيرات المطلوبة (JWT secrets, OAuth credentials, Stripe keys, إلخ)

# 3. تشغيل قواعد البيانات محلياً
docker compose up -d

# 4. (اختياري) إنشاء بيانات تجريبية
npm run seed:dev-users

# 5. تشغيل الخادم في وضع التطوير
npm run dev
```

الخادم يعمل الآن على: `http://localhost:3000/api/v1/health`

**تصفح قاعدة البيانات بصرياً (اختياري):** بعد `docker compose up -d`، افتح `http://localhost:8081` (مستخدم: `admin` / كلمة مرور: `local_dev_only` — أداة تطوير محلية فقط، لا تُنشَر أبداً في الإنتاج).

---

## استراتيجية الاختبار (Testing Strategy)

الاختبارات تتصل بـ MongoDB و Redis **حقيقيَّين** — عبر `docker-compose` محلياً، وعبر `services:` في GitHub Actions أثناء CI (راجع `.github/workflows/ci.yml`). هذا يعطي دقة أعلى من محاكاة في الذاكرة، ويتجنّب الحاجة لتحميل ملفات تنفيذية إضافية (تفادياً لتضخيم `node_modules` دون داعٍ). استخدم قاعدة بيانات منفصلة للاختبار (`hybrid_lms_test`) لتفادي تلويث بيانات التطوير.

---

## الأوامر المتاحة

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | تشغيل الخادم مع Hot Reload |
| `npm start` | تشغيل الخادم في وضع الإنتاج |
| `npm test` | تشغيل الاختبارات |
| `npm run test:coverage` | الاختبارات مع تقرير التغطية |
| `npm run test:watch` | تشغيل الاختبارات في وضع المراقبة |
| `npm run lint` | فحص جودة وأمان الكود (ESLint + eslint-plugin-security) |
| `npm run lint:fix` | إصلاح مشاكل الكود تلقائياً |
| `npm run format` | تنسيق الكود (Prettier) |
| `npm run seed:prod-superadmin` | إنشاء حساب Super Admin للإنتاج |
| `npm run seed:dev-users` | إنشاء بيانات مستخدمين تجريبية |
| `npm run seed:live-demo` | إنشاء بيانات جلسات مباشرة تجريبية |
| `npm run seed:peer-demo` | إنشاء بيانات مراجعة أقران تجريبية |

---

## هيكل المشروع (MVCS Architecture)

```
src/
├── config/         إعدادات البيئة، قواعد البيانات، OAuth، Stripe، سياسات الرفع
├── controllers/    استقبال الطلبات وإرسال الردود فقط (لا منطق أعمال هنا)
│   ├── admin/      إدارة النظام
│   ├── attendance/ الحضور
│   ├── auth/       المصادقة والأمان
│   ├── cert/       الشهادات الرقمية
│   ├── course/     المقررات
│   ├── kyc/        التحقق من الهوية
│   ├── live/       الجلسات المباشرة
│   ├── peer/       مراجعة الأقران
│   ├── report/     التقارير
│   └── user/       ملفات المستخدمين
├── services/       منطق الأعمال الفعلي (Business Logic)
├── models/         مخططات Mongoose (30+ نموذج بيانات)
├── middleware/     JWT auth, MFA, validation, rate limiting, CSRF, error handling
├── routes/         تعريف الـ Endpoints (13 مجموعة routes)
├── validators/     مخططات Zod للتحقق من المدخلات
├── sockets/        Socket.IO للجلسات المباشرة والتفاعل الفوري
├── utils/          دوال مساعدة (JWT, TOTP, تشفير AES-256-GCM, logger, CSV, إلخ)
└── app.js          تهيئة Express
└── server.js       نقطة الدخول الرئيسية
```

### الـ Endpoints الرئيسية (API Routes)

| المسار | الوصف |
|---|---|
| `/api/v1/health` | فحص صحة الخادم |
| `/api/v1/auth` | المصادقة (تسجيل، تسجيل دخول، MFA، OAuth، استعادة الحساب) |
| `/api/v1/users` | إدارة ملفات المستخدمين والصور الشخصية |
| `/api/v1/courses` | إدارة المقررات والتسجيل والتقدم |
| `/api/v1/quizzes` | الاختبارات القصيرة |
| `/api/v1/live` | الجلسات المباشرة |
| `/api/v1/peer` | مراجعة الأقران |
| `/api/v1/attendance` | تتبع الحضور |
| `/api/v1/payments` | معالجة المدفوعات والفواتير |
| `/api/v1/kyc` | التحقق من الهوية |
| `/api/v1/certificates` | إصدار والتحقق من الشهادات |
| `/api/v1/admin` | لوحة تحكم المسؤولين |
| `/api/v1/reports` | تقارير النظام |


### 5.1 Security Framework Overview

This implementation follows a **Defense-in-Depth** security strategy, implementing multiple overlapping layers of security controls. The approach aligns with the following security frameworks and standards:

- **OWASP Top 10 (2021):** Mitigations for all top 10 web application security risks
- **NIST Cybersecurity Framework:** Identify, Protect, Detect, Respond, Recover
- **NIST SP 800-53:** Security and privacy controls for information systems
- **NIST SP 800-63B:** Digital identity guidelines for authentication
- **CIS Controls v8:** Critical security controls for effective cyber defense
- **GDPR (EU 2016/679):** Data protection and privacy compliance
- **OWASP ASVS Level 2:** Application Security Verification Standard

### 5.2 OWASP Top 10 Mitigations

| Vulnerability | Mitigation Strategies Implemented |
|---------------|----------------------------------|
| **A01:2021 – Broken Access Control** | • Role-Based Access Control (RBAC) middleware<br>• JWT claims validation<br>• Resource ownership verification<br>• Principle of least privilege<br>• Anti-CSRF tokens |
| **A02:2021 – Cryptographic Failures** | • Argon2id password hashing<br>• AES-256-GCM encryption for sensitive data<br>• TLS 1.3 in transit<br>• Secure random number generation (crypto.randomBytes)<br>• No hardcoded secrets |
| **A03:2021 – Injection** | • Parameterized MongoDB queries<br>• Zod input validation<br>• Content Security Policy headers<br>• No eval() or Function() constructor<br>• eslint-plugin-security rules |
| **A04:2021 – Insecure Design** | • Threat modeling during design phase<br>• Secure defaults (deny by default)<br>• Rate limiting<br>• Input validation at boundaries<br>• Fail securely |
| **A05:2021 – Security Misconfiguration** | • Helmet.js security headers<br>• Environment-specific configurations<br>• Disabled directory listing<br>• Error messages don't leak sensitive info<br>• Dependency vulnerability scanning |
| **A06:2021 – Vulnerable Components** | • Dependabot automated updates<br>• npm audit in CI pipeline<br>• Pinned dependency versions<br>• Regular dependency reviews |
| **A07:2021 – Identification & Authentication Failures** | • MFA (TOTP) support<br>• Secure password policy<br>• Account lockout after failed attempts<br>• Secure session management<br>• No default credentials |
| **A08:2021 – Software & Data Integrity Failures** | • Webhook signature verification<br>• Digital signatures (Ed25519)<br>• Integrity checks on uploads<br>• Gitleaks prevents secret commits<br>• Code signing in CI/CD |
| **A09:2021 – Security Logging & Monitoring Failures** | • Winston structured logging<br>• Audit logs for sensitive operations<br>• Failed authentication tracking<br>• Anomaly detection (future)<br>• Centralized log aggregation ready |
| **A10:2021 – Server-Side Request Forgery (SSRF)** | • URL validation for user-provided URLs<br>• Allowlist for external services<br>• No direct external request proxying<br>• Network segmentation in production |

### 5.3 Authentication Security Architecture

**Password Storage:**
```
User Input → Argon2id Hashing → Database Storage
             ↓
    Parameters: memory=65536 KB (64MB)
                iterations=3
                parallelism=4
                type=argon2id (hybrid mode)
```

**Rationale for Argon2id:**
- Winner of Password Hashing Competition (2015)
- Memory-hard algorithm (resistant to GPU/ASIC attacks)
- Configurable resource requirements
- Hybrid mode (argon2id) combines benefits of argon2i (side-channel resistance) and argon2d (GPU resistance)
- NIST SP 800-63B explicitly recommends Argon2 or PBKDF2 (with 10,000+ iterations)

**Multi-Factor Authentication (MFA):**
```
┌─────────────────────────────────────────────────────┐
│              MFA Enrollment Flow                     │
├─────────────────────────────────────────────────────┤
│ 1. User requests MFA enrollment                     │
│ 2. Server generates secret (32-char base32)         │
│ 3. Server creates QR code URI (otpauth://)          │
│ 4. User scans QR with authenticator app             │
│ 5. User enters first TOTP code (verification)       │
│ 6. Server validates code                            │
│ 7. Server generates 10 backup codes                 │
│ 8. Backup codes displayed once (user must save)     │
│ 9. MFA activated on user account                    │
└─────────────────────────────────────────────────────┘
```

**TOTP Algorithm (RFC 6238):**
- Time step: 30 seconds
- Code digits: 6
- Hash algorithm: SHA-1 (RFC requirement, acceptable for TOTP)
- Time tolerance: ±1 step (allows 30-second clock skew)

**JWT Token Design:**
```javascript
// Access Token (Short-lived: 15 minutes)
{
  "sub": "userId",           // Subject (user ID)
  "role": "student",         // User role
  "iat": 1705449600,         // Issued at
  "exp": 1705450500,         // Expiration
  "jti": "unique-token-id"   // JWT ID (for revocation)
}

// Refresh Token (Long-lived: 7 days)
{
  "sub": "userId",
  "type": "refresh",
  "iat": 1705449600,
  "exp": 1706054400,
  "jti": "unique-token-id"
}
```

**Token Security Measures:**
- Access tokens stored in memory (JavaScript variable), never localStorage
- Refresh tokens in httpOnly cookies (XSS protection)
- Secure flag on cookies (HTTPS only)
- SameSite=Strict (CSRF protection)
- Token rotation on refresh (old refresh token invalidated)
- Revocation list in Redis (logout, password change, suspicious activity)

### 5.4 Authorization & Access Control

**Role-Based Access Control (RBAC) Model:**

| Role | Permissions | Use Case |
|------|-------------|----------|
| **Super Admin** | Full system access, user management, system configuration | System administrators |
| **Admin** | User management, content moderation, reports | Platform moderators |
| **Instructor** | Course CRUD, enrollment management, grading | Course creators |
| **Student** | Course enrollment, content access, assignment submission | Learners |
| **Guest** | Public course browsing, registration | Unauthenticated users |

**Permission Enforcement:**
```javascript
// Middleware stack example
app.post('/api/v1/courses',
  authenticateJWT,           // Verify JWT, extract user
  requireRole(['instructor', 'admin']),  // Check role
  validateRequest(createCourseSchema),   // Validate input
  courseController.createCourse          // Business logic
);
```

**Resource-Level Authorization:**
- Instructors can only modify their own courses
- Students can only access enrolled courses
- Admins can access all resources (with audit logging)

### 5.5 Input Validation & Sanitization

**Validation Strategy:**
1. **Syntactic Validation:** Check data format (Zod schemas)
2. **Semantic Validation:** Check business rules (Service layer)
3. **Sanitization:** Remove/escape dangerous characters
4. **Contextual Encoding:** Output encoding based on context (HTML, URL, JSON)

**Example Zod Schema:**
```javascript
const registerSchema = z.object({
  email: z.string().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  firstName: z.string().min(1).max(50).trim(),
  lastName: z.string().min(1).max(50).trim(),
  dateOfBirth: z.coerce.date().max(new Date()),
  role: z.enum(['student', 'instructor'])
});
```

### 5.6 Rate Limiting & Brute Force Protection

**Rate Limiting Strategy:**
- **Global Rate Limit:** 100 requests/minute per IP
- **Authentication Endpoints:** 5 attempts/15 minutes per IP (exponential backoff)
- **API Endpoints:** 60 requests/minute per authenticated user
- **File Uploads:** 10 uploads/hour per user

**Exponential Backoff (Android-style):**
```
Attempt 1: No delay
Attempt 2: 2 seconds
Attempt 3: 4 seconds
Attempt 4: 8 seconds
Attempt 5: 16 seconds
After 5 attempts: 15-minute lockout
```

**Implementation:** Redis-based rate limiting with sliding window algorithm

### 5.7 File Upload Security

**Security Controls:**
1. **File Type Validation:**
   - Magic number verification (not extension-based)
   - Allowlist of MIME types
   - Rejects executable files (.exe, .sh, .bat, .dll)

2. **File Size Limits:**
   - Images: 5MB max
   - Documents: 25MB max
   - Videos: 500MB max
   - Archives: 100MB max

3. **Malware Scanning:**
   - ClamAV integration (optional)
   - Asynchronous scanning to avoid blocking uploads
   - Quarantine suspicious files pending review

4. **Secure Storage:**
   - Files stored outside web root
   - Randomized filenames (UUID)
   - Access via pre-signed URLs (time-limited)
   - Content-Disposition: attachment (prevents inline execution)

5. **Image Processing:**
   - Strip EXIF metadata (privacy)
   - Resize to standard dimensions (prevent decompression bombs)
   - Re-encode to remove embedded payloads

### 5.8 CSRF Protection

**Token-Based CSRF Protection:**
```
1. Server generates CSRF token (cryptographically random)
2. Token stored in double-submit cookie + session
3. Client includes token in request header (X-CSRF-Token)
4. Server validates token matches cookie and session
5. Token rotated after sensitive operations
```

**SameSite Cookie Attribute:**
- `SameSite=Strict` for maximum protection
- Blocks cookies on cross-origin requests
- Fallback to token validation for legacy browsers

### 5.9 Security Headers (Helmet.js)

**HTTP Security Headers Implemented:**

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'` | Prevents XSS by restricting resource sources |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME type sniffing |
| `X-Frame-Options` | `DENY` | Prevents clickjacking |
| `X-XSS-Protection` | `1; mode=block` | Enables browser XSS filter |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforces HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Controls referrer information leakage |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` | Disables unnecessary browser features |

### 5.10 Encryption Implementation

**Data at Rest:**
- **Password Hashing:** Argon2id (irreversible)
- **Sensitive Fields:** AES-256-GCM (reversible, for MFA secrets, backup codes)
- **Database Encryption:** MongoDB encryption at rest (production)

**AES-256-GCM Encryption:**
```javascript
// Encryption process
plaintext → AES-256-GCM → ciphertext + authTag + IV

Parameters:
- Key size: 256 bits (32 bytes)
- Mode: GCM (Galois/Counter Mode)
- IV: 12 bytes (random, unique per encryption)
- Auth tag: 16 bytes (integrity verification)
```

**Advantages of GCM:**
- Authenticated encryption (confidentiality + integrity)
- Parallel processing (performance)
- NIST approved (SP 800-38D)

**Data in Transit:**
- TLS 1.3 (production)
- Certificate pinning (mobile apps)
- Perfect Forward Secrecy (ephemeral key exchange)

### 5.11 Audit Logging & Forensics

**Audit Log Structure:**
```json
{
  "timestamp": "2025-01-15T14:30:00.000Z",
  "eventType": "authentication.login.success",
  "actor": {
    "userId": "64f1c2a3...",
    "role": "student",
    "ip": "203.0.113.42",
    "userAgent": "Mozilla/5.0..."
  },
  "resource": {
    "type": "user",
    "id": "64f1c2a3..."
  },
  "details": {
    "method": "local",
    "mfaUsed": true
  },
  "result": "success"
}
```

**Events Logged:**
- All authentication attempts (success/failure)
- Authorization failures
- Data modifications (create, update, delete)
- Administrative actions
- Security events (suspicious activity, rate limit triggers)
- Payment transactions

**Log Retention:**
- Hot storage (MongoDB): 90 days
- Cold storage (compressed archives): 1 year
- Compliance: GDPR Article 30 (records of processing activities)

### 5.12 Dependency Security

**Supply Chain Security Measures:**
1. **Dependency Scanning:**
   - `npm audit` in CI pipeline
   - Semgrep with OWASP ruleset
   - Dependabot automated pull requests

2. **Version Pinning:**
   - Exact versions in package.json (no ^ or ~)
   - package-lock.json committed
   - Regular manual reviews of updates

3. **Source Verification:**
   - Official npm packages only
   - Checksums verified
   - Avoid packages with <1000 weekly downloads (supply chain risk)

4. **Secret Scanning:**
   - Gitleaks pre-commit hook (local)
   - Gitleaks in CI pipeline (GitHub Actions)
   - Alerts on potential secret commits

### 5.13 Security Testing

**Security Testing Types:**
1. **Static Application Security Testing (SAST):**
   - ESLint with eslint-plugin-security
   - Semgrep with OWASP rules
   - CodeQL (GitHub Advanced Security)

2. **Dependency Scanning:**
   - npm audit
   - Dependabot security alerts
   - Snyk (future integration planned)

3. **Secret Scanning:**
   - Gitleaks (pre-commit + CI)
   - TruffleHog (manual audits)

4. **Dynamic Application Security Testing (DAST):**
   - Manual penetration testing (planned)
   - OWASP ZAP automated scans (future)

5. **Security Code Reviews:**
   - Pull request reviews focus on security
   - Admin actions require two-person review
   - Regular security audits

---

## Software Engineering Standards & Compliance

### 6.1 Coding Standards

**JavaScript Style Guide:**
- **Base:** Airbnb JavaScript Style Guide (modified)
- **Indentation:** 2 spaces (enforced by Prettier)
- **Quotes:** Single quotes for strings
- **Semicolons:** Required
- **Naming Conventions:**
  - `camelCase` for variables and functions
  - `PascalCase` for classes and constructors
  - `UPPER_SNAKE_CASE` for constants
  - `_privateMethod` for internal functions (convention, not enforced)

**ESLint Configuration:**
```javascript
{
  "extends": [
    "eslint:recommended",
    "plugin:n/recommended",
    "plugin:security/recommended"
  ],
  "rules": {
    "no-console": "warn",          // Discourage console.log (use logger)
    "no-eval": "error",            // Prevent eval() usage
    "no-implied-eval": "error",    // Prevent Function() constructor
    "security/detect-object-injection": "error",
    "security/detect-non-literal-regexp": "warn"
  }
}
```

**Code Documentation Standards:**
- JSDoc comments for all public functions
- Inline comments for complex logic
- README in each module directory

### 6.2 API Design Standards

**RESTful Principles:**
1. **Resource-Based URLs:**
   - ✅ Good: `GET /api/v1/courses/123`
   - ❌ Bad: `GET /api/v1/getCourse?id=123`

2. **HTTP Verbs:**
   - `GET`: Retrieve resource (idempotent, no side effects)
   - `POST`: Create resource or non-idempotent operations
   - `PUT`: Update entire resource (idempotent)
   - `PATCH`: Partial update
   - `DELETE`: Remove resource (idempotent)

3. **HTTP Status Codes:**
   - `200 OK`: Success (GET, PUT, PATCH)
   - `201 Created`: Success (POST creating resource)
   - `204 No Content`: Success (DELETE)
   - `400 Bad Request`: Invalid input
   - `401 Unauthorized`: Missing/invalid authentication
   - `403 Forbidden`: Authenticated but insufficient permissions
   - `404 Not Found`: Resource doesn't exist
   - `409 Conflict`: State conflict (e.g., duplicate email)
   - `422 Unprocessable Entity`: Validation failed
   - `429 Too Many Requests`: Rate limit exceeded
   - `500 Internal Server Error`: Unexpected server error

4. **Response Format:**
   ```javascript
   // Success response
   {
     "success": true,
     "data": { /* resource data */ },
     "meta": { /* pagination, timestamps, etc. */ }
   }

   // Error response
   {
     "success": false,
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "Email is already registered",
       "field": "email"
     }
   }
   ```

5. **Versioning:**
   - URL-based versioning: `/api/v1/`
   - Version in Accept header (future): `Accept: application/vnd.hybrid-lms.v1+json`

6. **Pagination:**
   ```javascript
   GET /api/v1/courses?page=2&limit=20

   Response:
   {
     "data": [ /* courses */ ],
     "meta": {
       "page": 2,
       "limit": 20,
       "total": 156,
       "totalPages": 8
     }
   }
   ```

### 6.3 Database Design Standards

**Normalization:**
- 3rd Normal Form (3NF) for relational data
- Denormalization acceptable for read-heavy data (with justification)

**MongoDB Schema Design Patterns:**
1. **Embedding vs. Referencing:**
   - Embed: One-to-few relationships (course → units → lessons)
   - Reference: One-to-many or many-to-many (user → enrollments → courses)

2. **Indexing Strategy:**
   - Compound indexes for common query patterns
   - Text indexes for search functionality
   - Unique indexes for business constraints (email uniqueness)
   - TTL indexes for auto-expiring data (sessions, tokens)

3. **Schema Validation:**
   - Mongoose schema validation
   - Database-level validation (MongoDB JSON Schema)
   - Application-level validation (Zod)

### 6.4 Testing Standards

**Test Coverage Targets:**
- Unit Tests: >80% code coverage
- Integration Tests: All API endpoints
- E2E Tests: Critical user journeys
- Security Tests: All authentication/authorization paths

**Test Structure (AAA Pattern):**
```javascript
describe('AuthController.register', () => {
  it('should create user with valid inputs', async () => {
    // Arrange: Setup test data
    const userData = {
      email: 'test@example.com',
      password: 'SecurePass123!',
      // ...
    };

    // Act: Execute function under test
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(userData);

    // Assert: Verify results
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe('test@example.com');
  });
});
```

**Testing Best Practices:**
- Tests must be deterministic (no random failures)
- Tests must be isolated (no shared state)
- Use real dependencies (MongoDB, Redis) not mocks (for integration tests)
- Separate test database (`hybrid_lms_test`)
- Clean database between tests
- Descriptive test names (behavior, not implementation)

### 6.5 Version Control Standards

**Git Workflow:**
- **Main Branch:** Protected, production-ready code
- **Feature Branches:** `feature/AUTH-BE-01-registration`
- **Bug Fix Branches:** `fix/AUTH-BE-03-token-bug`
- **Naming Convention:** `[type]/[MODULE]-[BE]-[NN]-[description]`

**Commit Message Format:**
```
<type>(<scope>): <subject>

<body>

<footer>

Example:
feat(auth): implement MFA enrollment endpoint

Add POST /api/v1/auth/mfa/enroll endpoint for TOTP setup.
Returns QR code and backup codes.

Closes #42
```

**Commit Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting (no logic changes)
- `refactor`: Code restructuring (no behavior changes)
- `test`: Adding/modifying tests
- `chore`: Build process, dependencies, tooling

**Pull Request Requirements:**
- Descriptive title and description
- All CI checks passing (tests, linting, security scans)
- Code review by at least one team member
- No merge conflicts
- Updated documentation if needed

### 6.6 Compliance & Regulatory Standards

**GDPR Compliance:**
- **Lawful Basis:** Consent, contractual necessity, legitimate interest
- **Data Minimization:** Collect only necessary data
- **Right to Access:** Users can export their data
- **Right to Erasure:** Account deletion with 30-day recovery
- **Right to Rectification:** Users can update their information
- **Data Portability:** JSON export of user data
- **Privacy by Design:** Privacy considerations in design phase
- **Data Protection Officer:** Contact information provided
- **Breach Notification:** Procedures for notifying users within 72 hours

**COPPA Compliance (Children's Online Privacy Protection Act):**
- Age verification during registration
- Parental consent for users under 13
- No behavioral advertising to children
- Transparent privacy policy

**Accessibility (WCAG 2.1 Level AA):**
- Semantic HTML
- ARIA labels for dynamic content
- Keyboard navigation support
- Screen reader compatibility
- Color contrast ratios (4.5:1 for normal text)
- Alt text for images
- Captions for videos

**Note:** Full accessibility validation requires manual testing with assistive technologies and expert review.

---

## Development Environment Setup


### 7.1 System Requirements

**Minimum Requirements:**
- **Operating System:** Windows 10/11, macOS 12+, Ubuntu 20.04+
- **Node.js:** Version 22.x LTS or higher
- **RAM:** 8GB minimum, 16GB recommended
- **Disk Space:** 10GB free space
- **Docker:** Docker Desktop 4.0+ (for local database services)
- **Network:** Internet connection for dependency installation

**Recommended Development Tools:**
- **Code Editor:** Visual Studio Code with extensions:
  - ESLint
  - Prettier
  - Thunder Client (API testing)
  - MongoDB for VS Code
- **API Testing:** Postman or Insomnia
- **Git Client:** Git CLI or GitHub Desktop
- **Terminal:** Windows Terminal, iTerm2, or similar

### 7.2 Installation Steps

**Step 1: Clone Repository**
```bash
git clone <repository-url>
cd hybrid-lms-backend
```

**Step 2: Install Dependencies**
```bash
# Install Node.js dependencies
npm install

# Verify installation
npm list --depth=0
```

**Step 3: Environment Configuration**
```bash
# Copy example environment file
cp .env.example .env

# Edit .env file with your configuration
# Use a text editor to fill in the required values
```

**Required Environment Variables:**

| Variable | Description | Example/Format |
|----------|-------------|----------------|
| `NODE_ENV` | Environment mode | `development`, `production`, `test` |
| `PORT` | Server port | `3000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/hybrid_lms` |
| `MONGO_TEST_URI` | Test database URI | `mongodb://localhost:27017/hybrid_lms_test` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | JWT access token secret | 64+ character random string |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | 64+ character random string |
| `ENCRYPTION_MASTER_KEY` | AES-256 encryption key | 64-character hex string (32 bytes) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID | From Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth secret | From Google Cloud Console |
| `GOOGLE_OAUTH_REDIRECT_URI` | OAuth callback URL | `http://localhost:3000/api/v1/auth/google/callback` |
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | `whsec_...` |
| `GMAIL_CLIENT_ID` | Gmail OAuth client ID | From Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth secret | From Google Cloud Console |
| `GMAIL_REFRESH_TOKEN` | Gmail refresh token | From OAuth playground |
| `GMAIL_USER` | Gmail address for sending | `noreply@example.com` |
| `CERT_SIGNING_PRIVATE_KEY_PEM` | Ed25519 private key (PEM) | Generated with `npm run generate-keys` |
| `CERT_SIGNING_PUBLIC_KEY_PEM` | Ed25519 public key (PEM) | Generated with `npm run generate-keys` |
| `FRONTEND_URL` | Frontend application URL | `http://localhost:5173` |
| `CLAMAV_HOST` | ClamAV server host (optional) | `localhost` |
| `CLAMAV_PORT` | ClamAV server port (optional) | `3310` |

**Generating Secrets:**
```bash
# Generate JWT secrets (64 characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate AES-256 encryption key (32 bytes = 64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate Ed25519 key pair for certificates
npm run generate-keys  # (if script exists, otherwise use openssl)
# or
openssl genpkey -algorithm ed25519 -out private_key.pem
openssl pkey -in private_key.pem -pubout -out public_key.pem
```

**Step 4: Start Database Services**

Using Docker Compose:
```bash
# Start MongoDB and Redis containers
docker compose up -d

# Verify containers are running
docker ps

# Expected output:
# CONTAINER ID   IMAGE          PORTS
# xxxxx          mongo:8        0.0.0.0:27017->27017/tcp
# xxxxx          redis:7        0.0.0.0:6379->6379/tcp
# xxxxx          mongo-express  0.0.0.0:8081->8081/tcp (dev only)
```

**Step 5: Seed Database (Optional)**
```bash
# Create development users (admin, instructors, students)
npm run seed:dev-users

# Seed live session demo data
npm run seed:live-demo

# Seed peer review demo data
npm run seed:peer-demo
```

**Step 6: Start Development Server**
```bash
# Start with auto-reload (nodemon)
npm run dev

# Server starts on http://localhost:3000
# Health check: http://localhost:3000/api/v1/health
```

**Step 7: Verify Installation**
```bash
# Test health endpoint
curl http://localhost:3000/api/v1/health

# Expected response:
# {
#   "success": true,
#   "data": {
#     "status": "healthy",
#     "timestamp": "2025-01-15T14:30:00.000Z",
#     "uptime": 42.5,
#     "mongodb": "connected",
#     "redis": "connected"
#   }
# }
```

### 7.3 Docker Compose Configuration

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:8
    container_name: hybrid-lms-mongo
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: local_dev_password
    volumes:
      - mongodb_data:/data/db
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: hybrid-lms-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  mongo-express:
    image: mongo-express:latest
    container_name: hybrid-lms-mongo-express
    ports:
      - "8081:8081"
    environment:
      ME_CONFIG_MONGODB_ADMINUSERNAME: admin
      ME_CONFIG_MONGODB_ADMINPASSWORD: local_dev_password
      ME_CONFIG_MONGODB_URL: mongodb://admin:local_dev_password@mongodb:27017/
      ME_CONFIG_BASICAUTH_USERNAME: admin
      ME_CONFIG_BASICAUTH_PASSWORD: local_dev_only
    depends_on:
      - mongodb
    restart: unless-stopped
    # WARNING: Never deploy to production! Development only.

volumes:
  mongodb_data:
  redis_data:
```

**Important:** mongo-express is a development tool only. Never expose it in production environments. It provides a web UI at `http://localhost:8081` (credentials: admin/local_dev_only) for browsing MongoDB.

### 7.4 IDE Configuration

**VS Code Settings (`.vscode/settings.json`):**
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "javascript.suggest.autoImports": true,
  "javascript.updateImportsOnFileMove.enabled": "always",
  "files.eol": "\n",
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

**VS Code Extensions:**
- `dbaeumer.vscode-eslint` - ESLint integration
- `esbenp.prettier-vscode` - Code formatting
- `mongodb.mongodb-vscode` - MongoDB explorer
- `rangav.vscode-thunder-client` - API testing
- `usernamehw.errorlens` - Inline error highlighting

### 7.5 Troubleshooting Common Issues

**Issue 1: Port Already in Use**
```
Error: listen EADDRINUSE: address already in use :::3000
```
**Solution:**
```bash
# Find process using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

**Issue 2: MongoDB Connection Failure**
```
MongoServerError: Authentication failed
```
**Solution:**
- Verify MongoDB container is running: `docker ps`
- Check `MONGO_URI` in `.env` matches Docker Compose credentials
- Restart MongoDB container: `docker restart hybrid-lms-mongo`

**Issue 3: Redis Connection Failure**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Solution:**
- Verify Redis container is running: `docker ps`
- Check `REDIS_URL` in `.env` is correct
- Test Redis connection: `redis-cli ping` (should return `PONG`)

**Issue 4: npm install Fails**
```
Error: Cannot find module 'node:crypto'
```
**Solution:**
- Verify Node.js version: `node -v` (must be ≥22.0.0)
- Update Node.js: Download from [nodejs.org](https://nodejs.org/)
- Clear npm cache: `npm cache clean --force`

**Issue 5: Husky Hooks Not Running**
```
hint: The '.husky/pre-commit' hook was ignored...
```
**Solution:**
```bash
# Reinstall Husky
npm run prepare

# Make hooks executable (macOS/Linux)
chmod +x .husky/*

# Verify hooks
ls -la .husky/
```

---

## Testing Methodology & Quality Assurance


### 8.1 Testing Philosophy

This project adopts a **pragmatic testing approach** that balances thoroughness with development velocity. The testing strategy follows the **Testing Pyramid** principle:

```
         ┌───────────────┐
         │   E2E Tests   │  ← Few, slow, high-value
         │   (Planned)   │
         ├───────────────┤
         │ Integration   │  ← Some, moderate speed
         │     Tests     │     Test API endpoints
         └───────────────┘
                │
         ┌──────▼──────┐
         │    Unit      │  ← Many, fast, isolated
         │    Tests     │     Test business logic
         └─────────────┘
```

### 8.2 Test Infrastructure

**Real Dependencies vs. Mocks:**
This project uses **real MongoDB and Redis instances** for integration tests, not in-memory mocks. This approach provides higher confidence that code works in production-like environments.

**Rationale:**
- **Fidelity:** Tests run against actual database engines, catching database-specific issues
- **No Mock Maintenance:** Avoids overhead of maintaining mock implementations
- **CI/CD Integration:** GitHub Actions provides MongoDB and Redis as services
- **Isolation:** Separate test database (`hybrid_lms_test`) prevents data pollution

**Test Database Setup:**
```javascript
// tests/setup.js
beforeAll(async () => {
  // Connect to test database
  await mongoose.connect(process.env.MONGO_TEST_URI);
  await redisClient.connect();
});

afterAll(async () => {
  // Cleanup connections
  await mongoose.connection.close();
  await redisClient.quit();
});

beforeEach(async () => {
  // Clear database between tests (isolation)
  await mongoose.connection.db.dropDatabase();
  await redisClient.flushDb();
});
```

### 8.3 Unit Testing

**Scope:** Test individual functions and services in isolation

**Example: Password Validation**
```javascript
// tests/unit/utils/validation.test.js
const { validatePassword } = require('../../../src/utils/validation');

describe('Password Validation', () => {
  it('should accept strong password', () => {
    expect(validatePassword('SecurePass123!')).toBe(true);
  });

  it('should reject password without uppercase', () => {
    expect(validatePassword('weakpass123!')).toBe(false);
  });

  it('should reject password shorter than 8 characters', () => {
    expect(validatePassword('Short1!')).toBe(false);
  });

  // Property-based testing with fast-check
  it('should validate password criteria consistently', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (password) => {
          const result = validatePassword(password);
          // If password meets criteria, validation must pass
          if (
            password.length >= 8 &&
            /[A-Z]/.test(password) &&
            /[a-z]/.test(password) &&
            /\d/.test(password) &&
            /[!@#$%^&*]/.test(password)
          ) {
            return result === true;
          }
          return true; // Don't care about invalid passwords
        }
      )
    );
  });
});
```

### 8.4 Integration Testing

**Scope:** Test API endpoints with real database interactions

**Example: User Registration Endpoint**
```javascript
// tests/integration/auth.test.js
const request = require('supertest');
const app = require('../../src/app');

describe('POST /api/v1/auth/register', () => {
  it('should register new user with valid data', async () => {
    const userData = {
      email: 'newuser@example.com',
      password: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '2000-01-01',
      role: 'student'
    };

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(userData)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe('newuser@example.com');
    expect(response.body.data.emailVerified).toBe(false);
    
    // Verify user exists in database
    const user = await User.findOne({ email: 'newuser@example.com' });
    expect(user).toBeTruthy();
    expect(user.firstName).toBe('John');
  });

  it('should reject duplicate email', async () => {
    // First registration
    await request(app)
      .post('/api/v1/auth/register')
      .send({ /* userData */ });

    // Duplicate registration
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ /* same userData */ })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('should reject weak password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'weak',  // Too short, no uppercase/special chars
        // ...
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should require parental consent for minors', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'child@example.com',
        password: 'SecurePass123!',
        firstName: 'Child',
        lastName: 'User',
        dateOfBirth: '2015-01-01',  // Under 18
        role: 'student'
      })
      .expect(201);

    expect(response.body.data.requiresParentalConsent).toBe(true);
    expect(response.body.data.accountStatus).toBe('pending_parental_consent');
  });
});
```

### 8.5 Property-Based Testing

**Concept:** Instead of testing specific examples, generate random inputs to discover edge cases.

**Example: JWT Token Validation**
```javascript
const fc = require('fast-check');
const { generateToken, verifyToken } = require('../../src/utils/jwt');

describe('JWT Token Round-Trip', () => {
  it('should verify any valid token generated', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.uuidV4(),
          role: fc.constantFrom('student', 'instructor', 'admin'),
          email: fc.emailAddress()
        }),
        (payload) => {
          // Generate token with random payload
          const token = generateToken(payload, '15m');
          
          // Verify token
          const decoded = verifyToken(token);
          
          // Assertions
          expect(decoded.userId).toBe(payload.userId);
          expect(decoded.role).toBe(payload.role);
          return true;
        }
      ),
      { numRuns: 100 }  // Run 100 random tests
    );
  });

  it('should reject tokens with modified payload', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (userId) => {
          const token = generateToken({ userId }, '15m');
          
          // Tamper with token (modify payload)
          const parts = token.split('.');
          const tamperedPayload = Buffer.from('{"userId":"hacker"}').toString('base64url');
          const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
          
          // Should throw error
          expect(() => verifyToken(tamperedToken)).toThrow();
          return true;
        }
      )
    );
  });
});
```

### 8.6 Test Coverage Metrics

**Current Coverage Targets:**
- **Statements:** >80%
- **Branches:** >75%
- **Functions:** >80%
- **Lines:** >80%

**Coverage Report:**
```bash
npm run test:coverage

# Generates coverage report in coverage/lcov-report/index.html
# Open in browser to view detailed coverage metrics
```

**Coverage by Module (Example):**
| Module | Statements | Branches | Functions | Lines |
|--------|-----------|----------|-----------|-------|
| Auth Controllers | 92% | 88% | 95% | 91% |
| Auth Services | 87% | 82% | 90% | 86% |
| Course Controllers | 85% | 79% | 88% | 84% |
| Utils | 91% | 85% | 93% | 90% |
| Middleware | 88% | 83% | 90% | 87% |

**Interpreting Coverage:**
- **100% coverage ≠ bug-free:** Coverage measures test execution, not test quality
- **Focus on critical paths:** Prioritize authentication, authorization, payment processing
- **Acceptable gaps:** Error handling for rare edge cases, defensive code

### 8.7 Test Execution

**Running Tests:**
```bash
# Run all tests (sequential execution)
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Run specific test file
npm test -- tests/integration/auth.test.js

# Run tests matching pattern
npm test -- --testNamePattern="registration"
```

**GitHub Actions CI:**
```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mongodb:
        image: mongo:8
        ports:
          - 27017:27017
      
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - run: npm ci
      - run: npm run lint
      - run: npm audit
      - run: npm test
      - run: npm run test:coverage
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

### 8.8 Quality Assurance Checklist

**Pre-Commit Checklist (Automated by Husky):**
- ✅ ESLint passes (no errors)
- ✅ Prettier formatting applied
- ✅ No secrets in commit (Gitleaks scan)
- ✅ Tests pass locally

**Pre-Pull Request Checklist:**
- ✅ All tests pass
- ✅ Code coverage maintained or improved
- ✅ API documentation updated (if endpoints changed)
- ✅ Database migrations documented (if schema changed)
- ✅ Environment variables documented (if new variables added)
- ✅ Security implications considered
- ✅ Performance impact assessed

**Code Review Checklist:**
- ✅ Code follows project conventions
- ✅ No hardcoded credentials or secrets
- ✅ Error handling present
- ✅ Input validation implemented
- ✅ Authorization checks present
- ✅ Logging for audit trail
- ✅ Tests cover new functionality
- ✅ No obvious security vulnerabilities

---

## API Documentation & Interface Specifications

### 9.1 API Overview

**Base URL:** `http://localhost:3000/api/v1` (development)

**Authentication:** Most endpoints require JWT token in `Authorization` header:
```
Authorization: Bearer <access_token>
```

**Content Type:** All requests and responses use `application/json`

**API Versioning:** URL-based versioning (`/api/v1/`)

### 9.2 Endpoint Catalog

**Total Endpoints:** 100+ API endpoints across 13 route groups

| Route Group | Base Path | Endpoints | Description |
|-------------|-----------|-----------|-------------|
| Health | `/api/v1/health` | 1 | System health check |
| Authentication | `/api/v1/auth` | 15 | Registration, login, MFA, OAuth, password reset |
| Users | `/api/v1/users` | 8 | User profiles, avatars, preferences |
| Courses | `/api/v1/courses` | 25 | Course CRUD, enrollment, content, reviews |
| Quizzes | `/api/v1/quizzes` | 12 | Quiz creation, attempts, grading |
| Live Sessions | `/api/v1/live` | 10 | Session scheduling, management, chat |
| Peer Review | `/api/v1/peer` | 9 | Assignment distribution, reviews, grading |
| Attendance | `/api/v1/attendance` | 6 | Attendance tracking, reports |
| Payments | `/api/v1/payments` | 8 | Stripe checkout, invoices, refunds |
| KYC | `/api/v1/kyc` | 5 | Identity verification, document upload |
| Certificates | `/api/v1/certificates` | 4 | Certificate issuance, verification |
| Admin | `/api/v1/admin` | 15 | User management, audit logs, moderation |
| Reports | `/api/v1/reports` | 7 | System reports, analytics |

### 9.3 Sample API Specifications

**Authentication: User Registration**
```
POST /api/v1/auth/register

Request Body:
{
  "email": "student@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "2000-01-15",
  "role": "student"
}

Success Response (201 Created):
{
  "success": true,
  "data": {
    "userId": "64f1c2a3e4b0f1a2b3c4d5e6",
    "email": "student@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "student",
    "emailVerified": false,
    "createdAt": "2025-01-15T14:30:00.000Z"
  },
  "message": "Registration successful. Please check your email to verify your account."
}

Error Response (409 Conflict):
{
  "success": false,
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "An account with this email already exists",
    "field": "email"
  }
}
```

**Authentication: Login**
```
POST /api/v1/auth/login

Request Body:
{
  "email": "student@example.com",
  "password": "SecurePass123!"
}

Success Response (200 OK):
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "userId": "64f1c2a3...",
      "email": "student@example.com",
      "firstName": "John",
      "role": "student",
      "mfaEnabled": false
    }
  }
}

Headers:
Set-Cookie: refreshToken=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800

MFA Required Response (200 OK):
{
  "success": true,
  "data": {
    "mfaRequired": true,
    "mfaSessionToken": "temp_token_123...",
    "message": "Please enter your MFA code"
  }
}
```

**Courses: Create Course**
```
POST /api/v1/courses
Authorization: Bearer <instructor_token>

Request Body:
{
  "title": "Introduction to Node.js",
  "description": "Learn backend development with Node.js",
  "category": "Programming",
  "level": "beginner",
  "language": "en",
  "price": 49.99,
  "currency": "USD",
  "thumbnail": "<file_upload>",
  "units": [
    {
      "title": "Getting Started",
      "order": 1,
      "lessons": [
        {
          "title": "What is Node.js?",
          "type": "video",
          "contentUrl": "https://...",
          "duration": 600,
          "order": 1
        }
      ]
    }
  ]
}

Success Response (201 Created):
{
  "success": true,
  "data": {
    "courseId": "64f1c2a3...",
    "title": "Introduction to Node.js",
    "status": "draft",
    "instructor": {
      "userId": "64f1c2a3...",
      "name": "Jane Instructor"
    },
    "createdAt": "2025-01-15T14:30:00.000Z"
  }
}
```

**Complete API Documentation:**
- Full API specifications available in `docs/REST_API_Contract_v1.2_Groups1-4.docx`
- Interactive API documentation (future): Swagger/OpenAPI UI at `/api-docs`

### 9.4 Error Handling Standards

**Standard Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "field": "fieldName",  // Optional: for validation errors
    "details": {}  // Optional: additional context
  }
}
```

**Common Error Codes:**
| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `EMAIL_ALREADY_EXISTS` | 409 | Duplicate email registration |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |

---

## Database Design & Data Modeling

### 10.1 Database Architecture

**Database Management System:** MongoDB 8.x

**Architecture Pattern:** Single database with multiple collections, designed for future sharding

**Database Names:**
- **Production:** `hybrid_lms`
- **Development:** `hybrid_lms_dev`
- **Testing:** `hybrid_lms_test`

### 10.2 Entity Relationship Diagram

```
┌─────────────┐         ┌─────────────┐
│    User     │◄────────┤ Enrollment  │
│             │         │             │
│ - userId    │         │ - userId    │
│ - email     │         │ - courseId  │
│ - role      │         │ - status    │
│ - password  │         │ - progress  │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │                       │
       │                       ▼
       │              ┌─────────────┐
       │              │   Course    │
       │              │             │
       │              │ - courseId  │
       │              │ - instructor│
       │              │ - title     │
       │              │ - units[]   │
       │              └──────┬──────┘
       │                     │
       │                     │
       ▼                     ▼
┌─────────────┐       ┌─────────────┐
│  UserProfile│       │    Quiz     │
│             │       │             │
│ - userId    │       │ - courseId  │
│ - bio       │       │ - questions │
│ - avatar    │       │ - timeLimit │
└─────────────┘       └─────────────┘
```

### 10.3 Core Data Models

**30+ Mongoose Schemas Implemented:**

1. **User** - User accounts and authentication
2. **UserProfile** - Extended user information
3. **Course** - Course metadata and structure
4. **Unit** - Course units/modules
5. **Lesson** - Individual lessons
6. **Enrollment** - Course enrollments
7. **Progress** - Learning progress tracking
8. **Quiz** - Quiz definitions
9. **QuizAttempt** - Student quiz submissions
10. **Assignment** - Course assignments
11. **Submission** - Assignment submissions
12. **PeerReview** - Peer review assignments
13. **Review** - Individual peer reviews
14. **LiveSession** - Live session metadata
15. **LiveChat** - Chat messages
16. **Attendance** - Attendance records
17. **Certificate** - Digital certificates
18. **Payment** - Payment transactions
19. **Invoice** - Invoice records
20. **Refund** - Refund requests
21. **KYCRequest** - Identity verification requests
22. **KYCDocument** - Uploaded verification documents
23. **AuditLog** - System audit logs
24. **Notification** - User notifications
25. **CourseReview** - Course reviews and ratings
26. **PasswordReset** - Password reset tokens
27. **EmailVerification** - Email verification tokens
28. **MFASecret** - MFA configuration
29. **BackupCode** - MFA backup codes
30. **Session** - Active user sessions

**Sample Schema: User Model**
```javascript
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  passwordHash: {
    type: String,
    required: function() {
      return !this.oauth Provider;  // Not required for OAuth users
    }
  },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  role: {
    type: String,
    enum: ['student', 'instructor', 'admin', 'superadmin'],
    default: 'student',
    index: true
  },
  dateOfBirth: { type: Date, required: true },
  emailVerified: { type: Boolean, default: false },
  mfaEnabled: { type: Boolean, default: false },
  accountStatus: {
    type: String,
    enum: ['active', 'suspended', 'pending_deletion', 'pending_parental_consent'],
    default: 'active',
    index: true
  },
  oauthProvider: { type: String, enum: ['google', 'local'], default: 'local' },
  oauthId: { type: String, sparse: true, index: true },
  lastLoginAt: Date,
  failedLoginAttempts: { type: Number, default: 0 },
  lockedUntil: Date,
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1, accountStatus: 1 });
userSchema.index({ createdAt: -1 });

// Virtual: Full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Methods
userSchema.methods.toPublicJSON = function() {
  return {
    userId: this._id,
    email: this.email,
    firstName: this.firstName,
    lastName: this.lastName,
    role: this.role,
    emailVerified: this.emailVerified,
    mfaEnabled: this.mfaEnabled
  };
};
```

### 10.4 Indexing Strategy

**Index Types Implemented:**
- **Single-field indexes:** Email, userId, courseId (for primary key lookups)
- **Compound indexes:** `{ role: 1, accountStatus: 1 }` (for filtered queries)
- **Text indexes:** Course titles, descriptions (for search)
- **Unique indexes:** Email, certificate IDs (business constraints)
- **TTL indexes:** Tokens, sessions (auto-expiration)
- **Sparse indexes:** OAuth IDs (only for OAuth users)

**Index Performance:**
```javascript
// Example: Finding active instructors
db.users.createIndex({ role: 1, accountStatus: 1 });

// Query performance:
// Without index: 250ms (collection scan)
// With index: 3ms (index seek)
```

### 10.5 Data Validation

**Three-Layer Validation:**
1. **Application Layer (Zod):** Request validation before reaching controllers
2. **Mongoose Schema:** Schema-level validation rules
3. **Database Layer:** MongoDB JSON Schema validation (optional, for defense-in-depth)

**Example Validation:**
```javascript
// Layer 1: Zod (API request)
const createCourseSchema = z.object({
  title: z.string().min(5).max(200),
  price: z.number().min(0).max(9999.99)
});

// Layer 2: Mongoose
const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    minlength: 5,
    maxlength: 200
  },
  price: {
    type: Number,
    min: 0,
    max: 9999.99,
    required: true
  }
});

// Layer 3: MongoDB JSON Schema (optional)
db.runCommand({
  collMod: "courses",
  validator: {
    $jsonSchema: {
      properties: {
        title: { bsonType: "string", minLength: 5, maxLength: 200 },
        price: { bsonType: "number", minimum: 0, maximum: 9999.99 }
      }
    }
  }
});
```

### 10.6 Data Retention & Archival

**Retention Policies:**
- **User Data:** Retained until account deletion (+ 30-day recovery period)
- **Audit Logs:** 90 days hot storage, 1 year cold storage
- **Payment Records:** 7 years (compliance with financial regulations)
- **Course Content:** Indefinite (or until instructor deletion)
- **Session Tokens:** Auto-expire (TTL indexes)

**Soft Deletion Strategy:**
```javascript
// Instead of physical deletion
await User.deleteOne({ _id: userId });

// Use soft deletion
await User.updateOne(
  { _id: userId },
  {
    accountStatus: 'pending_deletion',
    deletionRequestedAt: new Date()
  }
);

// Background job deletes after 30 days
```

---

## Deployment Architecture & Operations

### 11.1 Deployment Environments

| Environment | Purpose | URL | Database |
|-------------|---------|-----|----------|
| **Development** | Local development | `http://localhost:3000` | Local MongoDB/Redis (Docker) |
| **Staging** | Pre-production testing | `https://staging-api.hybrid-lms.edu` | Cloud MongoDB Atlas |
| **Production** | Live system | `https://api.hybrid-lms.edu` | Cloud MongoDB Atlas (sharded) |

### 11.2 Production Architecture (Planned)

```
┌─────────────────────────────────────────────────────────────┐
│                     Load Balancer (Nginx)                    │
│                  (SSL Termination, Rate Limiting)            │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    ┌─────▼────┐   ┌────▼─────┐  ┌────▼─────┐
    │ Node.js  │   │ Node.js  │  │ Node.js  │
    │Instance 1│   │Instance 2│  │Instance 3│
    └────┬─────┘   └─────┬────┘  └────┬─────┘
         │               │            │
         └───────────────┼────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
    ┌────▼────┐   ┌──────▼──────┐  ┌────▼────┐
    │ MongoDB │   │Redis Cluster│  │ ClamAV  │
    │ Atlas   │   │ (Sessions,  │  │ Service │
    │(Replica │   │  Cache)     │  │         │
    │  Set)   │   └─────────────┘  └─────────┘
    └─────────┘
```

### 11.3 Environment Configuration

**Environment-Specific Settings:**
```javascript
// config/env.js
module.exports = {
  development: {
    logLevel: 'debug',
    corsOrigin: 'http://localhost:5173',
    rateLimitWindow: 60000,  // 1 minute
    rateLimitMax: 1000       // Relaxed for development
  },
  production: {
    logLevel: 'warn',
    corsOrigin: 'https://hybrid-lms.edu',
    rateLimitWindow: 60000,
    rateLimitMax: 100        // Strict for production
  }
};
```

### 11.4 Production Checklist

**Pre-Deployment Checklist:**
- ✅ All tests passing (>80% coverage)
- ✅ Security audits complete (npm audit, Semgrep, CodeQL)
- ✅ Environment variables configured (no defaults)
- ✅ Database migrations applied
- ✅ Backup strategy verified
- ✅ Monitoring and alerting configured
- ✅ SSL certificates valid
- ✅ Rate limiting configured appropriately
- ✅ Error tracking integrated (Sentry/equivalent)
- ✅ Log aggregation configured (ELK/Splunk/CloudWatch)
- ✅ DDoS protection enabled
- ✅ CDN configured for static assets
- ✅ Database indexes optimized
- ✅ Connection pools configured
- ✅ Health check endpoint responsive
- ✅ Documentation updated

**Post-Deployment Verification:**
- ✅ Health check returns 200 OK
- ✅ Database connections established
- ✅ Redis connections established
- ✅ SSL/TLS working correctly
- ✅ CORS configured properly
- ✅ Authentication flow working
- ✅ Payment processing functional (test mode)
- ✅ Email delivery working
- ✅ WebSocket connections stable
- ✅ Monitoring dashboards showing data
- ✅ Error rates within acceptable thresholds

---

## Performance Optimization & Scalability

### 12.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| API Response Time (p95) | <200ms | New Relic/Datadog |
| Database Query Time (p95) | <50ms | MongoDB Profiler |
| Page Load Time | <2s | Lighthouse |
| Concurrent Users | 10,000 | Load testing |
| WebSocket Connections | 5,000 | Socket.IO metrics |
| Uptime | 99.9% | Status page |

### 12.2 Optimization Strategies

**Database Optimization:**
- Query optimization (proper indexing)
- Connection pooling (max 100 connections)
- Read replicas for read-heavy workloads
- Aggregation pipeline optimization
- Projection (return only needed fields)

**Caching Strategy:**
- Redis caching for frequently accessed data
- HTTP cache headers for static content
- CDN for media files
- In-memory caching for session data

**Code Optimization:**
- Asynchronous processing for heavy tasks
- Batch operations instead of loops
- Lazy loading of related documents
- Pagination for large result sets
- Stream processing for large files

**Network Optimization:**
- Response compression (gzip/brotli)
- HTTP/2 support
- Connection keep-alive
- Reduced payload sizes (JSON minification)

### 12.3 Scalability Patterns

**Horizontal Scaling:**
- Stateless API servers (can add more instances)
- Redis Pub/Sub for WebSocket scaling
- Database sharding (future, when >1TB data)

**Load Balancing:**
- Round-robin distribution
- Sticky sessions for WebSocket connections
- Health check-based routing

**Resource Limits:**
- File upload size limits
- API rate limiting
- Connection pool limits
- Maximum concurrent WebSocket connections per server

---

## DevSecOps Pipeline & Continuous Integration

### 12.1 CI/CD Pipeline

**GitHub Actions Workflow:**
```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Secret Scanning (Gitleaks)
        uses: gitleaks/gitleaks-action@v2
      
      - name: Dependency Audit
        run: npm audit --audit-level=high
      
      - name: SAST Scanning (Semgrep)
        uses: returntocorp/semgrep-action@v1
        with:
          config: p/owasp-top-ten
  
  test:
    runs-on: ubuntu-latest
    needs: security-scan
    
    services:
      mongodb:
        image: mongo:8
        ports:
          - 27017:27017
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Lint Code
        run: npm run lint
      
      - name: Run Tests
        run: npm run test:coverage
        env:
          MONGO_TEST_URI: mongodb://localhost:27017/test
          REDIS_URL: redis://localhost:6379
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
```

### 12.2 Pre-Commit Hooks (Husky)

```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run linting and formatting
npm run lint:fix
npm run format

# Secret scanning
gitleaks protect --staged --verbose

# Run tests
npm test
```

### 12.3 Security Scanning Tools

| Tool | Purpose | Frequency |
|------|---------|-----------|
| **Gitleaks** | Secret detection | Pre-commit + CI |
| **npm audit** | Dependency vulnerabilities | CI + Weekly |
| **Semgrep** | SAST (static analysis) | CI |
| **CodeQL** | Advanced SAST | CI (GitHub Advanced Security) |
| **Dependabot** | Automated dependency updates | Weekly |
| **ESLint Security** | Code security patterns | Pre-commit + CI |

---

## Project Management & Development Workflow

### 13.1 Development Methodology

**Methodology:** Agile/Scrum (adapted for academic project)

**Sprint Duration:** 2 weeks

**Team Roles:**
- Product Owner: Academic supervisor
- Scrum Master: Project lead
- Development Team: Multi-functional (backend, frontend, QA)

### 13.2 Branching Strategy

**Git Flow (Modified):**
```
main (production-ready)
  │
  ├── develop (integration branch)
  │     │
  │     ├── feature/AUTH-BE-01-registration
  │     ├── feature/COURSE-BE-05-enrollment
  │     └── fix/AUTH-BE-03-token-bug
  │
  └── hotfix/SECURITY-critical-patch (emergency fixes)
```

**Branch Naming Convention:**
```
<type>/<module>-<layer>-<issue-number>-<description>

Examples:
- feature/AUTH-BE-01-mfa-enrollment
- fix/COURSE-BE-12-quiz-grading-bug
- refactor/PAYMENT-BE-08-stripe-integration

Types: feature, fix, refactor, docs, test
Modules: AUTH, COURSE, LIVE, PEER, PAYMENT, KYC, CERT, ADMIN
Layers: BE (backend), FE (frontend)
```

### 13.3 Code Review Process

**Review Criteria:**
1. **Functionality:** Code works as intended
2. **Security:** No vulnerabilities introduced
3. **Performance:** No significant performance degradation
4. **Tests:** Adequate test coverage
5. **Documentation:** Comments and docs updated
6. **Style:** Follows coding standards

**Review Checklist:**
- ✅ No hardcoded secrets
- ✅ Input validation present
- ✅ Authorization checks implemented
- ✅ Error handling comprehensive
- ✅ Logging for audit trail
- ✅ Tests passing
- ✅ Code follows DRY principle
- ✅ Documentation updated

### 13.4 Issue Tracking

**GitHub Projects Kanban Board:**
```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Backlog  │→ │ To Do    │→ │In Progress│→ │  Done    │
│          │  │          │  │          │  │          │
│ • Story  │  │ • Issue  │  │ • Task   │  │ • Task   │
│ • Epic   │  │ • Task   │  │ • Bug Fix│  │ • Feature│
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**Issue Labels:**
- `bug` - Something isn't working
- `enhancement` - New feature or request
- `security` - Security-related issue
- `documentation` - Documentation improvements
- `high-priority` - Urgent issue
- `good-first-issue` - Good for newcomers

---

## Future Enhancements & Research Directions

### 14.1 Planned Features (Roadmap)

**Phase 2 (Next 6 months):**
- [ ] Mobile applications (React Native)
- [ ] Video conferencing integration (WebRTC/Jitsi)
- [ ] AI-powered course recommendations
- [ ] Gamification (badges, leaderboards, achievements)
- [ ] Advanced analytics dashboard
- [ ] Multi-language support (i18n)
- [ ] Offline mode (Progressive Web App)
- [ ] Blockchain certificate anchoring (Ethereum/Polygon)

**Phase 3 (Research & Innovation):**
- [ ] AI-assisted grading (NLP for essays)
- [ ] Adaptive learning paths (ML-based personalization)
- [ ] VR/AR learning experiences
- [ ] Biometric authentication (facial recognition)
- [ ] Learning analytics predictive models
- [ ] Federated learning for privacy-preserving analytics

### 14.2 Technical Debt

**Known Limitations:**
- Monolithic architecture (plan to decompose into microservices)
- Limited horizontal scalability for WebSockets (need Kafka/RabbitMQ)
- No distributed tracing (add OpenTelemetry)
- Manual deployment process (need CI/CD automation)
- Limited observability (need comprehensive metrics)

### 14.3 Research Questions

1. **How can blockchain technology enhance academic credential verification?**
   - Current: Digital signatures with Ed25519
   - Future: Ethereum smart contracts for immutable ledger

2. **What machine learning models best predict student success?**
   - Features: Engagement metrics, quiz scores, attendance
   - Model: Gradient Boosting, Neural Networks

3. **How to optimize real-time video delivery for low-bandwidth environments?**
   - Adaptive bitrate streaming
   - WebRTC with selective forwarding units (SFU)

4. **What authentication methods balance security and user experience?**
   - Comparative study: Password + MFA vs. Passwordless (WebAuthn)

---

## References & Academic Sources

### 15.1 Technical Standards

1. **RFC 6749:** The OAuth 2.0 Authorization Framework. IETF, 2012.
2. **RFC 7519:** JSON Web Token (JWT). IETF, 2015.
3. **RFC 6238:** TOTP: Time-Based One-Time Password Algorithm. IETF, 2011.
4. **RFC 7159:** The JavaScript Object Notation (JSON) Data Interchange Format. IETF, 2014.

### 15.2 Security Standards & Guidelines

5. **OWASP Top 10 (2021):** Top Ten Web Application Security Risks. OWASP Foundation.
6. **NIST SP 800-63B:** Digital Identity Guidelines: Authentication and Lifecycle Management. NIST, 2017.
7. **NIST SP 800-53 Rev. 5:** Security and Privacy Controls for Information Systems. NIST, 2020.
8. **NIST SP 800-38D:** Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM). NIST, 2007.
9. **CIS Controls v8:** The 18 Critical Security Controls. Center for Internet Security, 2021.

### 15.3 Data Protection & Privacy

10. **GDPR (EU 2016/679):** General Data Protection Regulation. European Union, 2016.
11. **COPPA:** Children's Online Privacy Protection Act. U.S. Federal Trade Commission, 1998.
12. **ISO/IEC 27001:** Information Security Management Systems. ISO, 2013.

### 15.4 Software Engineering Literature

13. Martin, Robert C. *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Prentice Hall, 2017.
14. Richardson, Chris. *Microservices Patterns: With Examples in Java*. Manning Publications, 2018.
15. Evans, Eric. *Domain-Driven Design: Tackling Complexity in the Heart of Software*. Addison-Wesley, 2003.
16. Gamma, Erich, et al. *Design Patterns: Elements of Reusable Object-Oriented Software*. Addison-Wesley, 1994.

### 15.5 Educational Technology Research

17. Garrison, D. R., Anderson, T., & Archer, W. (2000). "Critical Inquiry in a Text-Based Environment: Computer Conferencing in Higher Education." *The Internet and Higher Education*, 2(2-3), 87-105.
18. Bloom, B. S. (1956). *Taxonomy of Educational Objectives: The Classification of Educational Goals*. David McKay Company.
19. Meyer, A., Rose, D. H., & Gordon, D. (2014). *Universal Design for Learning: Theory and Practice*. CAST Professional Publishing.

### 15.6 Node.js & MongoDB Documentation

20. Node.js Official Documentation. https://nodejs.org/docs/
21. MongoDB Manual. https://docs.mongodb.com/manual/
22. Express.js Guide. https://expressjs.com/en/guide/
23. Socket.IO Documentation. https://socket.io/docs/

---

## Appendices

### Appendix A: Glossary of Terms

| Term | Definition |
|------|------------|
| **Argon2id** | Hybrid password hashing algorithm combining resistance to GPU attacks and side-channel attacks |
| **CSRF** | Cross-Site Request Forgery: attack forcing authenticated users to execute unwanted actions |
| **Ed25519** | Edwards-curve Digital Signature Algorithm using Curve25519 |
| **JWT** | JSON Web Token: compact URL-safe means of representing claims |
| **MVCS** | Model-View-Controller-Service: architectural pattern separating concerns |
| **OWASP** | Open Web Application Security Project: non-profit foundation for software security |
| **RBAC** | Role-Based Access Control: access control based on user roles |
| **TOTP** | Time-based One-Time Password: algorithm generating temporary passwords |
| **WebSocket** | Full-duplex communication protocol over a single TCP connection |
| **XSS** | Cross-Site Scripting: injection attack executing malicious scripts |

### Appendix B: Acronyms

- **API:** Application Programming Interface
- **CRUD:** Create, Read, Update, Delete
- **CI/CD:** Continuous Integration/Continuous Deployment
- **COPPA:** Children's Online Privacy Protection Act
- **GDPR:** General Data Protection Regulation
- **HTTP:** Hypertext Transfer Protocol
- **HTTPS:** HTTP Secure
- **JSON:** JavaScript Object Notation
- **JWT:** JSON Web Token
- **KYC:** Know Your Customer
- **LMS:** Learning Management System
- **MFA:** Multi-Factor Authentication
- **MVCS:** Model-View-Controller-Service
- **NIST:** National Institute of Standards and Technology
- **OAuth:** Open Authorization
- **OWASP:** Open Web Application Security Project
- **PCI DSS:** Payment Card Industry Data Security Standard
- **REST:** Representational State Transfer
- **SAST:** Static Application Security Testing
- **SMTP:** Simple Mail Transfer Protocol
- **SQL:** Structured Query Language
- **SSL/TLS:** Secure Sockets Layer / Transport Layer Security
- **TOTP:** Time-based One-Time Password
- **TTL:** Time To Live
- **UUID:** Universally Unique Identifier
- **WCAG:** Web Content Accessibility Guidelines
- **WSS:** WebSocket Secure

### Appendix C: Command Reference

**Development Commands:**
```bash
npm run dev              # Start development server with hot reload
npm start                # Start production server
npm test                 # Run test suite
npm run test:coverage    # Run tests with coverage report
npm run test:watch       # Run tests in watch mode
npm run lint             # Check code quality and security
npm run lint:fix         # Auto-fix linting issues
npm run format           # Format code with Prettier
```

**Database Seeding:**
```bash
npm run seed:dev-users         # Create development users
npm run seed:prod-superadmin   # Create production superadmin
npm run seed:live-demo         # Seed live session demo data
npm run seed:peer-demo         # Seed peer review demo data
```

**Docker Commands:**
```bash
docker compose up -d            # Start all services
docker compose down             # Stop all services
docker compose logs -f          # Follow logs
docker compose ps               # List running containers
docker compose restart mongodb  # Restart specific service
```

### Appendix D: Environment Variables Reference

See Section 7.2 for complete environment variables documentation.

### Appendix E: Project File Structure

```
hybrid-lms-backend/
├── .github/
│   └── workflows/
│       └── ci.yml                  # GitHub Actions CI/CD pipeline
├── .husky/                         # Git hooks (Husky)
│   ├── pre-commit                  # Pre-commit hook (lint, test, secret scan)
│   └── _/                          # Husky internal files
├── coverage/                       # Test coverage reports
├── docs/                           # Project documentation
│   ├── Module_DB_Design_Specification_v1.3.docx
│   ├── REST_API_Contract_v1.2_Groups1-4.docx
│   └── AUTH_Wireframes_v1.2.html
├── scripts/                        # Utility scripts
│   ├── seedDevUsers.js             # Development data seeding
│   ├── seedProdSuperAdmin.js       # Production admin setup
│   ├── seedLiveDemoData.js
│   └── seedPeerDemoData.js
├── src/                            # Source code
│   ├── config/                     # Configuration files
│   │   ├── env.js                  # Environment configuration
│   │   ├── googleOAuth.js          # Google OAuth config
│   │   ├── stripe.js               # Stripe config
│   │   └── uploadPolicies.js       # File upload policies
│   ├── controllers/                # HTTP request handlers
│   │   ├── admin/                  # Admin controllers
│   │   ├── attendance/             # Attendance controllers
│   │   ├── auth/                   # Authentication controllers
│   │   ├── cert/                   # Certificate controllers
│   │   ├── course/                 # Course controllers
│   │   ├── kyc/                    # KYC controllers
│   │   ├── live/                   # Live session controllers
│   │   ├── peer/                   # Peer review controllers
│   │   ├── report/                 # Reporting controllers
│   │   └── user/                   # User controllers
│   ├── middleware/                 # Express middleware
│   │   ├── auth.js                 # JWT authentication
│   │   ├── authorize.js            # Role-based authorization
│   │   ├── validate.js             # Input validation (Zod)
│   │   ├── rateLimiter.js          # Rate limiting
│   │   ├── csrf.js                 # CSRF protection
│   │   └── errorHandler.js         # Global error handler
│   ├── models/                     # Mongoose schemas (30+ models)
│   │   ├── User.js
│   │   ├── Course.js
│   │   ├── Enrollment.js
│   │   └── ... (27 more models)
│   ├── routes/                     # API route definitions
│   │   ├── authRoutes.js
│   │   ├── courseRoutes.js
│   │   ├── userRoutes.js
│   │   └── ... (10 more route files)
│   ├── services/                   # Business logic layer
│   │   ├── authService.js
│   │   ├── courseService.js
│   │   ├── paymentService.js
│   │   └── ... (service files)
│   ├── sockets/                    # Socket.IO handlers
│   │   ├── liveSessionSocket.js
│   │   └── chatSocket.js
│   ├── utils/                      # Utility functions
│   │   ├── jwt.js                  # JWT token utilities
│   │   ├── totp.js                 # TOTP utilities
│   │   ├── encryption.js           # AES-256-GCM encryption
│   │   ├── logger.js               # Winston logger
│   │   ├── emailService.js         # Email sending
│   │   └── ... (helper functions)
│   ├── validators/                 # Zod validation schemas
│   │   ├── authValidator.js
│   │   ├── courseValidator.js
│   │   └── ... (validation schemas)
│   ├── app.js                      # Express app setup
│   └── server.js                   # Entry point
├── tests/                          # Test files
│   ├── integration/                # Integration tests
│   │   ├── auth.test.js
│   │   ├── course.test.js
│   │   └── ...
│   ├── unit/                       # Unit tests
│   │   ├── utils/
│   │   ├── services/
│   │   └── ...
│   └── setup.js                    # Test configuration
├── .dockerignore                   # Docker ignore patterns
├── .env                            # Environment variables (not in git)
├── .env.example                    # Environment variables template
├── .eslintrc.json                  # ESLint configuration
├── .gitignore                      # Git ignore patterns
├── .gitleaks.toml                  # Gitleaks secret scanning config
├── .prettierrc                     # Prettier configuration
├── .prettierignore                 # Prettier ignore patterns
├── babel.config.js                 # Babel transpilation config
├── docker-compose.yml              # Docker services definition
├── jest.config.js                  # Jest testing configuration
├── package.json                    # npm dependencies and scripts
├── package-lock.json               # Dependency lock file
└── README.md                       # This file
```

### Appendix F: Contact & Support

**Academic Institution:** Syrian Virtual University (SVU)  
**Project Course:** BPR601 — Bachelor Project (Spring 2025)  
**Module Lead:** Yazan Joureah — Student ID: 174681  
**Role:** Backend Engineering & Cybersecurity Lead

**Repository Issues:** Use GitHub Issues for bug reports and feature requests  
**Pull Requests:** Contributions welcome (follow CONTRIBUTING.md guidelines)  
**Security Vulnerabilities:** Report privately to project maintainers

---

## Acknowledgments

This project was developed as part of the BPR601 graduation project at Syrian Virtual University. Special thanks to:

- Academic supervisors for guidance and feedback
- Open-source community for excellent tools and libraries
- Fellow team members for collaboration
- Testing participants for valuable feedback

---

## License

**UNLICENSED** - Academic Project

This software is developed as an academic project for Syrian Virtual University. All rights reserved. No license is granted for use, modification, or distribution without explicit permission from the project authors and the university.

For academic or research inquiries, please contact the project maintainers.

---

**Document Version:** 2.0  
**Last Updated:** January 15, 2025  
**Author:** Yazan Joureah (174681)  
**Project:** Hybrid LMS Backend — BPR601 S25
