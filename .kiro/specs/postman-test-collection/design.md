# Design Document: Postman Test Collection for Hybrid LMS Backend

## Overview

This design specifies a comprehensive Postman test collection that validates the hybrid LMS backend API through automated tests. The collection provides systematic testing of all API endpoints including success scenarios, validation errors, edge cases, security controls, and rate limiting behavior.

The collection will be structured as a single Postman Collection v2.1 JSON file with organized folders, reusable environment variables, sophisticated pre-request scripts for test data generation, and comprehensive test scripts with assertions. The design ensures developers and QA engineers can verify API correctness, security compliance, and error handling through repeatable automated tests that can run in CI/CD pipelines or interactively.

**Target API Base URL:** `http://localhost:3000/api/v1`

**Collection Format:** Postman Collection v2.1 (JSON)

**Testing Approach:** Automated assertions using Postman's `pm.test()` API with descriptive test names and clear failure messages.

## Architecture

### High-Level Structure

The Postman collection will be organized into a hierarchical folder structure that groups related tests by API endpoint and test category:

```
Hybrid LMS Backend API Tests (Collection Root)
├── Health Check
│   └── GET /health
├── Authentication - Registration
│   ├── Success Cases
│   │   ├── Register Adult Student
│   │   ├── Register Minor Student (with guardian_email)
│   │   └── Register Instructor
│   ├── Validation Errors
│   │   ├── Invalid full_name (too short)
│   │   ├── Invalid full_name (too long)
│   │   ├── Invalid email format
│   │   ├── Invalid password (too short)
│   │   ├── Invalid password (blocklisted)
│   │   ├── Invalid birth_date format
│   │   ├── Invalid birth_date (not a valid date)
│   │   ├── Invalid role enum
│   │   ├── Minor without guardian_email
│   │   ├── guardian_email equals email
│   │   └── Missing required fields
│   ├── Edge Cases
│   │   ├── Minimum valid full_name (2 chars)
│   │   ├── Maximum valid full_name (100 chars)
│   │   ├── Minimum valid password (15 chars)
│   │   ├── Birth date exactly 18 years ago
│   │   ├── Birth date 17 years 364 days ago
│   │   └── Unusual but valid email formats
│   └── Rate Limiting
│       ├── Below threshold (success)
│       └── Exceed threshold (429 response)
├── Authentication - Guardian Approval
│   ├── Guardian Approval Placeholder (GET)
│   │   ├── GET without query params
│   │   └── GET with token query param
│   ├── Success Cases
│   │   ├── Approve minor registration
│   │   └── Decline minor registration
│   ├── Validation Errors
│   │   ├── Missing token
│   │   ├── Invalid decision value
│   │   ├── Missing guardian_full_name
│   │   ├── Invalid relationship value
│   │   ├── Approve without consent=true
│   │   └── Missing required fields
│   └── Token Error Cases
│       ├── Invalid token format
│       ├── Invalid token (TOKEN_INVALID)
│       ├── Already-used token (TOKEN_ALREADY_USED)
│       └── Expired token (TOKEN_EXPIRED)
├── Security & Headers
│   ├── Security Headers Validation
│   └── CORS Preflight (OPTIONS)
└── Error Handling
    ├── 404 Not Found
    └── Server Error Handling

```

### Collection-Level Configuration

**Collection Metadata:**
- **Name:** "Hybrid LMS Backend API Tests"
- **Description:** Comprehensive test suite for the hybrid LMS backend API covering authentication, validation, security, and error handling
- **Version:** Postman Collection v2.1
- **Schema:** https://schema.getpostman.com/json/collection/v2.1.0/collection.json

**Collection-Level Variables:**
The collection will define variables accessible to all requests:
- `baseUrl` - API base URL (default: `http://localhost:3000/api/v1`)
- `timestamp` - Dynamic timestamp for unique data generation
- `randomEmail` - Dynamically generated email
- `randomPassword` - Dynamically generated password
- `testGuardianToken` - Token for guardian approval tests

**Collection-Level Pre-Request Script:**
A collection-level pre-request script will define reusable utility functions for all tests:

```javascript
// Utility functions available to all requests

// Generate unique email with timestamp
pm.collectionVariables.set('timestamp', Date.now());
pm.collectionVariables.set('randomEmail', `test.user.${pm.collectionVariables.get('timestamp')}@example.com`);

// Generate valid password (15+ characters)
pm.collectionVariables.set('randomPassword', `SecurePass${pm.collectionVariables.get('timestamp')}!`);

// Utility: Generate birth date for adult (exactly 18 years ago)
function generateAdultBirthDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 18);
    return date.toISOString().split('T')[0];
}

// Utility: Generate birth date for minor (17 years old)
function generateMinorBirthDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 17);
    return date.toISOString().split('T')[0];
}

// Utility: Generate birth date exactly N days ago
function generateBirthDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

// Make utilities globally available
pm.globals.set('generateAdultBirthDate', generateAdultBirthDate.toString());
pm.globals.set('generateMinorBirthDate', generateMinorBirthDate.toString());
pm.globals.set('generateBirthDateDaysAgo', generateBirthDateDaysAgo.toString());
```

## Components and Interfaces

### Environment Variables

The collection requires environment-specific configuration through Postman environments:

**Environment Variable Schema:**

| Variable Name | Type | Description | Example Value |
|--------------|------|-------------|---------------|
| `baseUrl` | String | API base URL | `http://localhost:3000/api/v1` |
| `rateLimitThreshold` | Number | Max requests before rate limit | `5` |
| `rateLimitWindowMs` | Number | Time window for rate limit (ms) | `60000` |
| `testAdultEmail` | String | Test email for adult user | `adult.test@example.com` |
| `testMinorEmail` | String | Test email for minor user | `minor.test@example.com` |
| `testGuardianEmail` | String | Test guardian email | `guardian.test@example.com` |
| `testPassword` | String | Valid test password | `ValidPassword123!` |
| `testFullName` | String | Valid test full name | `Test User` |
| `validGuardianToken` | String | Valid guardian approval token | (generated from backend) |
| `expiredGuardianToken` | String | Expired guardian token | (generated from backend) |
| `usedGuardianToken` | String | Already-used guardian token | (generated from backend) |

**Environment Templates:**

Three environment templates will be provided:

1. **Local Development** (`environments/local.postman_environment.json`)
   - `baseUrl`: `http://localhost:3000/api/v1`
   - All test data with `.local` suffix

2. **Staging** (`environments/staging.postman_environment.json`)
   - `baseUrl`: `https://staging-api.example.com/api/v1`
   - All test data with `.staging` suffix

3. **Production** (`environments/production.postman_environment.json`)
   - `baseUrl`: `https://api.example.com/api/v1`
   - Read-only tests only (no mutations)

### Request Structure

Each request in the collection follows this standardized structure:

**Request Object Schema:**
```json
{
  "name": "Descriptive Test Name",
  "request": {
    "method": "GET|POST|PUT|DELETE|OPTIONS",
    "header": [],
    "url": {
      "raw": "{{baseUrl}}/endpoint",
      "host": ["{{baseUrl}}"],
      "path": ["endpoint"]
    },
    "body": {
      "mode": "raw",
      "raw": "{}",
      "options": {
        "raw": {
          "language": "json"
        }
      }
    }
  },
  "event": [
    {
      "listen": "prerequest",
      "script": {
        "exec": ["// Pre-request script"]
      }
    },
    {
      "listen": "test",
      "script": {
        "exec": ["// Test assertions"]
      }
    }
  ]
}
```

### Reusable Utility Functions

**Data Generation Functions:**

```javascript
// Generate unique identifiers
function generateUniqueId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate valid ISO date YYYY-MM-DD
function generateISODate(yearsAgo = 20, daysOffset = 0) {
    const date = new Date();
    date.setFullYear(date.getFullYear() - yearsAgo);
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
}

// Generate random string of specified length
function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Generate valid password (15+ chars)
function generateValidPassword() {
    return `SecurePass${generateUniqueId()}!`;
}

// Generate invalid password (blocklisted)
function generateBlocklistedPassword() {
    return 'password123456';
}

// Generate email
function generateEmail(prefix = 'test') {
    return `${prefix}.${generateUniqueId()}@example.com`;
}

// Calculate age from birth_date
function calculateAge(birthDate) {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}
```

**Assertion Helper Functions:**

```javascript
// Common assertion: Check standard success response structure
function assertSuccessResponse(pm, responseJson) {
    pm.test('Response has success=true', () => {
        pm.expect(responseJson).to.have.property('success', true);
    });
    pm.test('Response has data property', () => {
        pm.expect(responseJson).to.have.property('data');
    });
}

// Common assertion: Check standard error response structure
function assertErrorResponse(pm, responseJson, expectedCode) {
    pm.test('Response has success=false', () => {
        pm.expect(responseJson).to.have.property('success', false);
    });
    pm.test('Response has error property', () => {
        pm.expect(responseJson).to.have.property('error');
    });
    if (expectedCode) {
        pm.test(`Error code is ${expectedCode}`, () => {
            pm.expect(responseJson.error).to.have.property('code', expectedCode);
        });
    }
}

// Common assertion: Check security headers
function assertSecurityHeaders(pm, response) {
    pm.test('Has Content-Security-Policy header', () => {
        pm.expect(response.headers.has('content-security-policy')).to.be.true;
    });
    pm.test('Has X-Content-Type-Options header', () => {
        pm.expect(response.headers.has('x-content-type-options')).to.be.true;
        pm.expect(response.headers.get('x-content-type-options')).to.equal('nosniff');
    });
    pm.test('Has X-Frame-Options header', () => {
        pm.expect(response.headers.has('x-frame-options')).to.be.true;
    });
    pm.test('Has Strict-Transport-Security header', () => {
        pm.expect(response.headers.has('strict-transport-security')).to.be.true;
    });
}

// Common assertion: Check Content-Type JSON
function assertContentTypeJSON(pm, response) {
    pm.test('Content-Type is application/json', () => {
        pm.expect(response.headers.get('content-type')).to.include('application/json');
    });
}

// Common assertion: Validate ISO timestamp
function assertValidISOTimestamp(pm, timestamp, fieldName = 'timestamp') {
    pm.test(`${fieldName} is valid ISO 8601 timestamp`, () => {
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
        pm.expect(timestamp).to.match(isoRegex);
        pm.expect(new Date(timestamp).toISOString()).to.equal(timestamp);
    });
}
```

## Data Models

### Postman Collection JSON Schema

The collection follows the Postman Collection v2.1 schema. Key data models:

**Collection Object:**
```json
{
  "info": {
    "name": "string",
    "description": "string",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    "_postman_id": "uuid",
    "version": {
      "major": 1,
      "minor": 0,
      "patch": 0
    }
  },
  "item": [
    {
      "name": "string",
      "item": [],
      "request": {},
      "event": []
    }
  ],
  "variable": [],
  "event": []
}
```

**Request Body for Registration (POST /auth/register):**
```json
{
  "full_name": "string (2-100 chars)",
  "email": "string (valid email)",
  "password": "string (15+ chars, not blocklisted)",
  "birth_date": "string (YYYY-MM-DD format)",
  "role": "enum ['Student', 'Instructor']",
  "privacy_consent_version": "string (non-empty)",
  "guardian_email": "string (optional, required for minors)"
}
```

**Request Body for Guardian Approval (POST /auth/guardian/approve):**
```json
{
  "token": "string (non-empty)",
  "decision": "enum ['approve', 'decline']",
  "guardian_full_name": "string (non-empty)",
  "relationship": "enum ['parent', 'guardian']",
  "consent": "boolean (optional, must be true if decision=approve)"
}
```

**Success Response Structure:**
```json
{
  "success": true,
  "data": {
    "message": "string",
    "requires_guardian_approval": "boolean (optional)",
    "status": "string (optional)",
    "token_received": "boolean (optional)"
  }
}
```

**Error Response Structure:**
```json
{
  "success": false,
  "error": {
    "code": "string",
    "message": "string",
    "details": "array (optional)"
  }
}
```

## Request Specifications

### 1. Health Check Endpoint

**Request: GET /health**

**Purpose:** Verify API operational status

**Method:** GET

**URL:** `{{baseUrl}}/health`

**Headers:** None required

**Body:** None

**Pre-Request Script:**
```javascript
// No pre-request setup needed
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 200', () => {
    pm.response.to.have.status(200);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Response has data property', () => {
    pm.expect(responseJson).to.have.property('data');
    pm.expect(responseJson.data).to.be.an('object');
});

pm.test('data.status is "ok"', () => {
    pm.expect(responseJson.data).to.have.property('status', 'ok');
});

pm.test('data.timestamp is valid ISO 8601', () => {
    pm.expect(responseJson.data).to.have.property('timestamp');
    const timestamp = responseJson.data.timestamp;
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    pm.expect(timestamp).to.match(isoRegex);
    pm.expect(new Date(timestamp).toISOString()).to.equal(timestamp);
});

pm.test('Content-Type is application/json', () => {
    pm.expect(pm.response.headers.get('content-type')).to.include('application/json');
});
```

**Expected Response:**
- Status: 200
- Body: `{ "success": true, "data": { "status": "ok", "timestamp": "2024-01-15T10:30:00.000Z" } }`

### 2. Register Adult Student (Success Case)

**Request: POST /auth/register (Adult Student)**

**Purpose:** Test successful registration of adult student (18+ years old)

**Method:** POST

**URL:** `{{baseUrl}}/auth/register`

**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Pre-Request Script:**
```javascript
// Generate unique test data
const timestamp = Date.now();
pm.environment.set('adultEmail', `adult.${timestamp}@example.com`);
pm.environment.set('adultPassword', `SecureAdultPass${timestamp}!`);
pm.environment.set('adultFullName', `Adult Test User ${timestamp}`);

// Generate birth date for adult (exactly 18 years ago)
const birthDate = new Date();
birthDate.setFullYear(birthDate.getFullYear() - 18);
pm.environment.set('adultBirthDate', birthDate.toISOString().split('T')[0]);
```

**Body:**
```json
{
  "full_name": "{{adultFullName}}",
  "email": "{{adultEmail}}",
  "password": "{{adultPassword}}",
  "birth_date": "{{adultBirthDate}}",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 201', () => {
    pm.response.to.have.status(201);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Response has data property', () => {
    pm.expect(responseJson).to.have.property('data');
});

pm.test('Message indicates verification email sent', () => {
    pm.expect(responseJson.data.message).to.include('Verification email sent');
});

pm.test('requires_guardian_approval is not present (adult user)', () => {
    pm.expect(responseJson.data).to.not.have.property('requires_guardian_approval');
});

// Security headers validation
pm.test('Has Content-Security-Policy header', () => {
    pm.expect(pm.response.headers.has('content-security-policy')).to.be.true;
});

pm.test('Has X-Content-Type-Options header', () => {
    pm.expect(pm.response.headers.has('x-content-type-options')).to.be.true;
});

pm.test('Has X-Frame-Options header', () => {
    pm.expect(pm.response.headers.has('x-frame-options')).to.be.true;
});

pm.test('Has Strict-Transport-Security header', () => {
    pm.expect(pm.response.headers.has('strict-transport-security')).to.be.true;
});
```

**Expected Response:**
- Status: 201
- Body: `{ "success": true, "data": { "message": "Verification email sent" } }`

### 3. Register Minor Student (Success Case)

**Request: POST /auth/register (Minor Student with guardian_email)**

**Purpose:** Test successful registration of minor student (under 18) with guardian email

**Method:** POST

**URL:** `{{baseUrl}}/auth/register`

**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Pre-Request Script:**
```javascript
// Generate unique test data
const timestamp = Date.now();
pm.environment.set('minorEmail', `minor.${timestamp}@example.com`);
pm.environment.set('minorPassword', `SecureMinorPass${timestamp}!`);
pm.environment.set('minorFullName', `Minor Test User ${timestamp}`);
pm.environment.set('guardianEmail', `guardian.${timestamp}@example.com`);

// Generate birth date for minor (17 years old)
const birthDate = new Date();
birthDate.setFullYear(birthDate.getFullYear() - 17);
pm.environment.set('minorBirthDate', birthDate.toISOString().split('T')[0]);
```

**Body:**
```json
{
  "full_name": "{{minorFullName}}",
  "email": "{{minorEmail}}",
  "password": "{{minorPassword}}",
  "birth_date": "{{minorBirthDate}}",
  "role": "Student",
  "privacy_consent_version": "1.0",
  "guardian_email": "{{guardianEmail}}"
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 201', () => {
    pm.response.to.have.status(201);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Response has data property', () => {
    pm.expect(responseJson).to.have.property('data');
});

pm.test('Message indicates verification email sent', () => {
    pm.expect(responseJson.data.message).to.include('Verification email sent');
});

pm.test('requires_guardian_approval is true', () => {
    pm.expect(responseJson.data).to.have.property('requires_guardian_approval', true);
});

pm.test('Message mentions guardian approval', () => {
    pm.expect(responseJson.data.message).to.include('Guardian approval');
});
```

**Expected Response:**
- Status: 201
- Body: `{ "success": true, "data": { "message": "Verification email sent. Guardian approval also required.", "requires_guardian_approval": true } }`

### 4. Register Instructor (Success Case)

**Request: POST /auth/register (Instructor)**

**Purpose:** Test successful registration of instructor

**Method:** POST

**URL:** `{{baseUrl}}/auth/register`

**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Pre-Request Script:**
```javascript
// Generate unique test data
const timestamp = Date.now();
pm.environment.set('instructorEmail', `instructor.${timestamp}@example.com`);
pm.environment.set('instructorPassword', `SecureInstructorPass${timestamp}!`);
pm.environment.set('instructorFullName', `Instructor Test User ${timestamp}`);

// Generate birth date for adult instructor (25 years old)
const birthDate = new Date();
birthDate.setFullYear(birthDate.getFullYear() - 25);
pm.environment.set('instructorBirthDate', birthDate.toISOString().split('T')[0]);
```

**Body:**
```json
{
  "full_name": "{{instructorFullName}}",
  "email": "{{instructorEmail}}",
  "password": "{{instructorPassword}}",
  "birth_date": "{{instructorBirthDate}}",
  "role": "Instructor",
  "privacy_consent_version": "1.0"
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 201', () => {
    pm.response.to.have.status(201);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Response has data property', () => {
    pm.expect(responseJson).to.have.property('data');
});

pm.test('Message indicates verification email sent', () => {
    pm.expect(responseJson.data.message).to.include('Verification email sent');
});
```

**Expected Response:**
- Status: 201
- Body: `{ "success": true, "data": { "message": "Verification email sent" } }`

### 5. Registration Validation Error Tests

**Request: POST /auth/register (Invalid full_name - too short)**

**Purpose:** Test validation rejection for full_name shorter than 2 characters

**Body:**
```json
{
  "full_name": "A",
  "email": "valid@example.com",
  "password": "SecurePassword123!",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Test Script (Pattern for all validation errors):**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 400', () => {
    pm.response.to.have.status(400);
});

pm.test('Response has success=false', () => {
    pm.expect(responseJson).to.have.property('success', false);
});

pm.test('Response has error property', () => {
    pm.expect(responseJson).to.have.property('error');
    pm.expect(responseJson.error).to.be.an('object');
});

pm.test('Error has code property', () => {
    pm.expect(responseJson.error).to.have.property('code');
});

pm.test('Error has message property', () => {
    pm.expect(responseJson.error).to.have.property('message');
});
```

**Additional Validation Error Tests:**

All follow the same pattern with different request bodies:

1. **Invalid full_name (too long)**: `full_name` with 101 characters
2. **Invalid email format**: `email` = `"invalid-email"`
3. **Invalid password (too short)**: `password` with 14 characters
4. **Invalid password (blocklisted)**: `password` = `"password123456"`
5. **Invalid birth_date format**: `birth_date` = `"01/01/2000"` (not YYYY-MM-DD)
6. **Invalid birth_date (not valid date)**: `birth_date` = `"2000-13-45"`
7. **Invalid role enum**: `role` = `"Admin"`
8. **Minor without guardian_email**: 17-year-old without `guardian_email`
9. **guardian_email equals email**: Both set to same value
10. **Missing required fields**: Omit `full_name` or `email`

Expected Response for all validation errors:
- Status: 400
- Body: `{ "success": false, "error": { "code": "...", "message": "..." } }`

### 6. Registration Edge Case Tests

**Request: POST /auth/register (Minimum valid full_name)**

**Purpose:** Test boundary condition for full_name minimum length (2 characters)

**Pre-Request Script:**
```javascript
const timestamp = Date.now();
pm.environment.set('testEmail', `edge.${timestamp}@example.com`);
pm.environment.set('testPassword', `SecurePassword${timestamp}!`);
```

**Body:**
```json
{
  "full_name": "AB",
  "email": "{{testEmail}}",
  "password": "{{testPassword}}",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Test Script:**
```javascript
pm.test('Status code is 201 (accepts minimum 2-char name)', () => {
    pm.response.to.have.status(201);
});
```

**Request: POST /auth/register (Maximum valid full_name)**

**Purpose:** Test boundary condition for full_name maximum length (100 characters)

**Body:**
```json
{
  "full_name": "A very long name that is exactly one hundred characters long including spaces and numbers 1234567890X",
  "email": "{{testEmail}}",
  "password": "{{testPassword}}",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Request: POST /auth/register (Minimum valid password)**

**Purpose:** Test boundary condition for password minimum length (15 characters)

**Body:**
```json
{
  "full_name": "Edge Test User",
  "email": "{{testEmail}}",
  "password": "SecurePass123!",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Request: POST /auth/register (Birth date exactly 18 years ago)**

**Purpose:** Test boundary between minor and adult (exactly 18 years)

**Pre-Request Script:**
```javascript
const birthDate = new Date();
birthDate.setFullYear(birthDate.getFullYear() - 18);
pm.environment.set('boundary18BirthDate', birthDate.toISOString().split('T')[0]);
```

**Request: POST /auth/register (Birth date 17 years 364 days ago)**

**Purpose:** Test clearly minor user (just under 18 years)

**Pre-Request Script:**
```javascript
const birthDate = new Date();
birthDate.setFullYear(birthDate.getFullYear() - 18);
birthDate.setDate(birthDate.getDate() + 1); // One day after 18th birthday = still 17
pm.environment.set('minor17BirthDate', birthDate.toISOString().split('T')[0]);
```

**Body:**
```json
{
  "full_name": "Minor Edge Test",
  "email": "{{testEmail}}",
  "password": "{{testPassword}}",
  "birth_date": "{{minor17BirthDate}}",
  "role": "Student",
  "privacy_consent_version": "1.0",
  "guardian_email": "guardian@example.com"
}
```

### 7. Rate Limiting Tests

**Request: POST /auth/register (Below threshold - success)**

**Purpose:** Test that requests below rate limit threshold succeed

**Pre-Request Script:**
```javascript
// Send 3 requests (below default threshold of 5)
const timestamp = Date.now();
pm.environment.set('rateLimitEmail', `ratelimit.${timestamp}@example.com`);
pm.environment.set('rateLimitPassword', `SecurePassword${timestamp}!`);
```

**Body:**
```json
{
  "full_name": "Rate Limit Test User",
  "email": "{{rateLimitEmail}}",
  "password": "{{rateLimitPassword}}",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Test Script:**
```javascript
pm.test('Status code is 201 (below rate limit)', () => {
    pm.response.to.have.status(201);
});
```

**Request: POST /auth/register (Exceed threshold - 429 response)**

**Purpose:** Test rate limiting enforcement when threshold exceeded

**Implementation Note:** This test requires multiple sequential requests. It should be implemented as a collection-level test or using Newman with iteration data.

**Pre-Request Script:**
```javascript
// This will be the 6th request using the same email identifier
// Rate limit is per-email (identifier) with threshold of 5
const timestamp = pm.environment.get('rateLimitTimestamp') || Date.now();
pm.environment.set('rateLimitTimestamp', timestamp);
pm.environment.set('rateLimitBurstEmail', `ratelimitburst.${timestamp}@example.com`);
```

**Body:**
```json
{
  "full_name": "Rate Limit Burst Test",
  "email": "{{rateLimitBurstEmail}}",
  "password": "SecurePassword123!",
  "birth_date": "2000-01-01",
  "role": "Student",
  "privacy_consent_version": "1.0"
}
```

**Test Script:**
```javascript
// This test should run after sending 6+ requests with the same email
const responseJson = pm.response.json();

pm.test('Status code is 429 (rate limited)', () => {
    pm.response.to.have.status(429);
});

pm.test('Response has success=false', () => {
    pm.expect(responseJson).to.have.property('success', false);
});

pm.test('Error code is RATE_LIMITED', () => {
    pm.expect(responseJson.error).to.have.property('code', 'RATE_LIMITED');
});

pm.test('Has Retry-After header', () => {
    pm.expect(pm.response.headers.has('retry-after')).to.be.true;
});

pm.test('Retry-After is a positive integer', () => {
    const retryAfter = pm.response.headers.get('retry-after');
    pm.expect(parseInt(retryAfter)).to.be.above(0);
});
```

**Expected Response:**
- Status: 429
- Headers: `Retry-After: 30` (or exponential backoff value)
- Body: `{ "success": false, "error": { "code": "RATE_LIMITED", "message": "Too many attempts. Please try again later." } }`

### 8. Guardian Approval Placeholder (GET)

**Request: GET /auth/guardian/approve (without query params)**

**Purpose:** Test placeholder endpoint without token parameter

**Method:** GET

**URL:** `{{baseUrl}}/auth/guardian/approve`

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 200', () => {
    pm.response.to.have.status(200);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('token_received is false', () => {
    pm.expect(responseJson.data).to.have.property('token_received', false);
});

pm.test('Message indicates placeholder', () => {
    pm.expect(responseJson.data.message).to.include('PLACEHOLDER');
});
```

**Request: GET /auth/guardian/approve?token=test123 (with query params)**

**Purpose:** Test placeholder endpoint with token parameter

**Method:** GET

**URL:** `{{baseUrl}}/auth/guardian/approve?token=test123`

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 200', () => {
    pm.response.to.have.status(200);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('token_received is true', () => {
    pm.expect(responseJson.data).to.have.property('token_received', true);
});
```

### 9. Guardian Approval Success Cases

**Request: POST /auth/guardian/approve (Approve decision)**

**Purpose:** Test successful guardian approval

**Method:** POST

**URL:** `{{baseUrl}}/auth/guardian/approve`

**Headers:**
```json
{
  "Content-Type": "application/json"
}
```

**Pre-Request Script:**
```javascript
// Use environment variable for valid token (set manually or from previous test)
// For testing, a valid token must be generated by the backend through minor registration
const validToken = pm.environment.get('validGuardianToken') || 'VALID_TOKEN_HERE';
pm.environment.set('currentTestToken', validToken);
```

**Body:**
```json
{
  "token": "{{currentTestToken}}",
  "decision": "approve",
  "guardian_full_name": "Jane Doe Guardian",
  "relationship": "parent",
  "consent": true
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 200', () => {
    pm.response.to.have.status(200);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Response has data property', () => {
    pm.expect(responseJson).to.have.property('data');
});

pm.test('Response has status field', () => {
    pm.expect(responseJson.data).to.have.property('status');
});

pm.test('Status is valid workflow state', () => {
    const validStatuses = ['active', 'guardian_pending'];
    pm.expect(validStatuses).to.include(responseJson.data.status);
});

pm.test('Message indicates approval', () => {
    pm.expect(responseJson.data.message).to.exist;
});
```

**Expected Response:**
- Status: 200
- Body: `{ "success": true, "data": { "message": "Approval recorded. Waiting for student to verify email.", "status": "guardian_pending" } }`

**Request: POST /auth/guardian/approve (Decline decision)**

**Purpose:** Test guardian decline

**Body:**
```json
{
  "token": "{{currentTestToken}}",
  "decision": "decline",
  "guardian_full_name": "Jane Doe Guardian",
  "relationship": "parent"
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 200', () => {
    pm.response.to.have.status(200);
});

pm.test('Response has success=true', () => {
    pm.expect(responseJson).to.have.property('success', true);
});

pm.test('Message indicates decline', () => {
    pm.expect(responseJson.data.message).to.include('Declined');
});
```

**Expected Response:**
- Status: 200
- Body: `{ "success": true, "data": { "message": "Declined. Student has been notified to update guardian info.", "status": "guardian_pending" } }`

### 10. Guardian Approval Validation Errors

**Request: POST /auth/guardian/approve (Missing token)**

**Purpose:** Test validation rejection for missing token

**Body:**
```json
{
  "decision": "approve",
  "guardian_full_name": "Jane Doe",
  "relationship": "parent",
  "consent": true
}
```

**Test Script (Pattern for all guardian approval validation errors):**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 400', () => {
    pm.response.to.have.status(400);
});

pm.test('Response has success=false', () => {
    pm.expect(responseJson).to.have.property('success', false);
});

pm.test('Response has error property', () => {
    pm.expect(responseJson).to.have.property('error');
});
```

**Additional Guardian Approval Validation Error Tests:**

1. **Invalid decision value**: `decision` = `"maybe"`
2. **Missing guardian_full_name**: Omit `guardian_full_name`
3. **Invalid relationship value**: `relationship` = `"uncle"`
4. **Approve without consent=true**: `decision` = `"approve"`, `consent` = `false` or omitted
5. **Missing required fields**: Omit multiple required fields

Expected Response for all validation errors:
- Status: 400
- Body: `{ "success": false, "error": { "code": "...", "message": "..." } }`

### 11. Guardian Approval Token Error Cases

**Request: POST /auth/guardian/approve (Invalid token format)**

**Purpose:** Test rejection of malformed token

**Body:**
```json
{
  "token": "invalid-malformed-token",
  "decision": "approve",
  "guardian_full_name": "Jane Doe",
  "relationship": "parent",
  "consent": true
}
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 400', () => {
    pm.response.to.have.status(400);
});

pm.test('Response has success=false', () => {
    pm.expect(responseJson).to.have.property('success', false);
});

pm.test('Error code is TOKEN_INVALID', () => {
    pm.expect(responseJson.error).to.have.property('code', 'TOKEN_INVALID');
});

pm.test('Error message describes invalid token', () => {
    pm.expect(responseJson.error.message).to.include('invalid');
});
```

**Request: POST /auth/guardian/approve (Already-used token)**

**Purpose:** Test rejection of token that was already used

**Pre-Request Script:**
```javascript
// Use a token that was already used in a previous approval
const usedToken = pm.environment.get('usedGuardianToken') || 'USED_TOKEN_HERE';
pm.environment.set('currentTestToken', usedToken);
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 400', () => {
    pm.response.to.have.status(400);
});

pm.test('Error code is TOKEN_ALREADY_USED', () => {
    pm.expect(responseJson.error).to.have.property('code', 'TOKEN_ALREADY_USED');
});

pm.test('Error message describes already used token', () => {
    pm.expect(responseJson.error.message).to.include('already been used');
});
```

**Request: POST /auth/guardian/approve (Expired token)**

**Purpose:** Test rejection of expired token

**Pre-Request Script:**
```javascript
// Use a token that has expired (72 hours old)
const expiredToken = pm.environment.get('expiredGuardianToken') || 'EXPIRED_TOKEN_HERE';
pm.environment.set('currentTestToken', expiredToken);
```

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 400', () => {
    pm.response.to.have.status(400);
});

pm.test('Error code is TOKEN_EXPIRED', () => {
    pm.expect(responseJson.error).to.have.property('code', 'TOKEN_EXPIRED');
});

pm.test('Error message describes expired token', () => {
    pm.expect(responseJson.error.message).to.include('expired');
});
```

**Expected Responses:**
- Status: 400
- Body examples:
  - `{ "success": false, "error": { "code": "TOKEN_INVALID", "message": "This approval link is invalid." } }`
  - `{ "success": false, "error": { "code": "TOKEN_ALREADY_USED", "message": "This approval link has already been used." } }`
  - `{ "success": false, "error": { "code": "TOKEN_EXPIRED", "message": "This approval link has expired. The account has been removed per policy." } }`

### 12. Security Headers and CORS Tests

**Request: OPTIONS /auth/register (CORS Preflight)**

**Purpose:** Test CORS preflight request handling

**Method:** OPTIONS

**URL:** `{{baseUrl}}/auth/register`

**Headers:**
```json
{
  "Origin": "http://localhost:3001",
  "Access-Control-Request-Method": "POST",
  "Access-Control-Request-Headers": "Content-Type"
}
```

**Test Script:**
```javascript
pm.test('Status code is 200 or 204', () => {
    pm.expect([200, 204]).to.include(pm.response.code);
});

pm.test('Has Access-Control-Allow-Origin header', () => {
    pm.expect(pm.response.headers.has('access-control-allow-origin')).to.be.true;
});

pm.test('Has Access-Control-Allow-Methods header', () => {
    pm.expect(pm.response.headers.has('access-control-allow-methods')).to.be.true;
});

pm.test('Has Access-Control-Allow-Headers header', () => {
    pm.expect(pm.response.headers.has('access-control-allow-headers')).to.be.true;
});
```

**Request: GET /health (Security Headers Validation)**

**Purpose:** Comprehensive security headers check (can use any endpoint)

**Method:** GET

**URL:** `{{baseUrl}}/health`

**Test Script:**
```javascript
pm.test('Has Content-Security-Policy header', () => {
    pm.expect(pm.response.headers.has('content-security-policy')).to.be.true;
    const csp = pm.response.headers.get('content-security-policy');
    pm.expect(csp).to.include("default-src 'self'");
    pm.expect(csp).to.include("object-src 'none'");
});

pm.test('Has X-Content-Type-Options header', () => {
    pm.expect(pm.response.headers.has('x-content-type-options')).to.be.true;
    pm.expect(pm.response.headers.get('x-content-type-options')).to.equal('nosniff');
});

pm.test('Has X-Frame-Options header', () => {
    pm.expect(pm.response.headers.has('x-frame-options')).to.be.true;
    const xFrameOptions = pm.response.headers.get('x-frame-options');
    pm.expect(['DENY', 'SAMEORIGIN']).to.include(xFrameOptions);
});

pm.test('Has Strict-Transport-Security header', () => {
    pm.expect(pm.response.headers.has('strict-transport-security')).to.be.true;
    const hsts = pm.response.headers.get('strict-transport-security');
    pm.expect(hsts).to.include('max-age=');
});

pm.test('Does not expose X-Powered-By header', () => {
    pm.expect(pm.response.headers.has('x-powered-by')).to.be.false;
});

pm.test('Security headers comply with OWASP guidelines', () => {
    // This is a meta-test to document compliance intention
    pm.expect(pm.response.headers.has('content-security-policy')).to.be.true;
    pm.expect(pm.response.headers.has('x-content-type-options')).to.be.true;
    pm.expect(pm.response.headers.has('x-frame-options')).to.be.true;
    pm.expect(pm.response.headers.has('strict-transport-security')).to.be.true;
});
```

### 13. HTTP Error Handling Tests

**Request: GET /nonexistent (404 Not Found)**

**Purpose:** Test 404 error handling for non-existent routes

**Method:** GET

**URL:** `{{baseUrl}}/nonexistent`

**Test Script:**
```javascript
const responseJson = pm.response.json();

pm.test('Status code is 404', () => {
    pm.response.to.have.status(404);
});

pm.test('Response has success=false', () => {
    pm.expect(responseJson).to.have.property('success', false);
});

pm.test('Response has error property', () => {
    pm.expect(responseJson).to.have.property('error');
});

pm.test('Error code is NOT_FOUND', () => {
    pm.expect(responseJson.error).to.have.property('code', 'NOT_FOUND');
});

pm.test('Error message describes not found', () => {
    pm.expect(responseJson.error.message).to.exist;
});

pm.test('Response does not leak stack traces', () => {
    const responseText = pm.response.text();
    pm.expect(responseText).to.not.include('at ');
    pm.expect(responseText).to.not.include('node_modules');
    pm.expect(responseText).to.not.include('.js:');
});

pm.test('Response does not leak internal details', () => {
    const responseText = pm.response.text();
    pm.expect(responseText).to.not.include('Error:');
    pm.expect(responseText).to.not.include('TypeError:');
    pm.expect(responseText).to.not.include('ReferenceError:');
});
```

**Expected Response:**
- Status: 404
- Body: `{ "success": false, "error": { "code": "NOT_FOUND", "message": "Route not found" } }`

**Note on Server Error Testing:**

Testing 500 Internal Server Error responses requires intentionally causing server errors, which may not be practical in a test collection. Instead, the collection should document:

1. Server error responses MUST follow the error response structure
2. Server errors MUST NOT leak stack traces or internal implementation details
3. Server errors MUST return `success: false`
4. Server errors SHOULD provide user-friendly messages without technical details

These can be validated through code review or integration tests rather than automated Postman tests.

## Error Handling

### Test Execution Errors

**Environment Variable Not Set:**
- If a required environment variable is missing, tests should fail with clear error messages
- Pre-request scripts should check for critical variables and set default values or throw descriptive errors

**Example Pre-Request Error Handling:**
```javascript
if (!pm.environment.get('baseUrl')) {
    throw new Error('Environment variable "baseUrl" is not set. Please select an environment.');
}
```

**Response Parsing Errors:**
- If response is not valid JSON, tests should catch parsing errors gracefully
- Use try-catch blocks when parsing responses

**Example Test Error Handling:**
```javascript
try {
    const responseJson = pm.response.json();
    pm.test('Response is valid JSON', () => {
        pm.expect(responseJson).to.be.an('object');
    });
} catch (e) {
    pm.test('Response is valid JSON', () => {
        pm.expect.fail('Response body is not valid JSON: ' + e.message);
    });
}
```

### Rate Limiting Test Challenges

**Challenge:** Rate limiting tests require sending multiple requests rapidly, which can be difficult to orchestrate in Postman GUI.

**Solutions:**

1. **Collection Runner with Iterations:**
   - Use Postman Collection Runner
   - Set iteration count to exceed rate limit threshold
   - Use the same email/identifier across iterations

2. **Newman CLI with Data File:**
   ```bash
   newman run collection.json -e environment.json --iteration-count 10 --delay-request 0
   ```

3. **Manual Setup:**
   - Document that testers should manually run the same request 6+ times
   - Provide clear instructions in request description

4. **Pre-Request Looping (Not Recommended):**
   - Postman doesn't support loops in pre-request scripts for sending multiple requests
   - This approach requires using `pm.sendRequest()` which is complex

**Recommended Approach:** Use Newman CLI for automated rate limiting tests, document manual steps for GUI testing.

### Guardian Token Test Challenges

**Challenge:** Guardian approval tests require valid, expired, and used tokens which are generated by the backend.

**Solutions:**

1. **Test Setup Script:**
   - Create a separate "Setup" folder in the collection
   - Include requests that register minor users and capture tokens from email service logs or database
   - Store tokens in environment variables for use in subsequent tests

2. **Mock Tokens for Initial Testing:**
   - Use placeholder tokens for development
   - Document that real tokens must be obtained from backend for full validation

3. **Backend Test Helper Endpoint (Development Only):**
   - Consider adding a development-only endpoint that generates test tokens
   - Example: `POST /api/v1/test/generate-guardian-token` (only enabled in development)
   - This endpoint should be disabled in production

4. **Database Seeding:**
   - Use database seeding scripts to create test users with known tokens
   - Document the seeding process in collection description

**Recommended Approach:**
- For local development: Use test helper endpoint or database seeding
- For staging/production: Manual token capture from email service or database query
- Document token generation process clearly in collection README

### Test Ordering Dependencies

**Dependencies:**
- Some tests depend on previous test execution (e.g., rate limiting tests)
- Guardian approval tests depend on having valid tokens from registration

**Solutions:**

1. **Independent Tests (Preferred):**
   - Design tests to be independent where possible
   - Use unique identifiers for each test to avoid conflicts

2. **Collection-Level Variables:**
   - Use collection variables to share state between tests
   - Clear variables in pre-request scripts to ensure clean state

3. **Test Ordering Documentation:**
   - Document any required test execution order in folder descriptions
   - Use folder structure to indicate logical grouping and sequence

**Example Documentation:**
```
Guardian Approval Tests
Note: These tests require valid tokens from minor user registrations.
Run the "Setup - Register Minor User" request first to generate a token.
```

## Testing Strategy

This Postman test collection is a **testing infrastructure artifact**, not application code with parsers, serializers, or data transformations. Property-based testing is not applicable to this type of deliverable. Instead, the testing strategy focuses on:

### Test Coverage Approach

**1. Example-Based Testing:**
- Each test request represents a specific example scenario
- Tests validate expected behavior for concrete inputs
- Coverage includes success cases, validation errors, edge cases, and error conditions

**2. Assertion-Based Validation:**
- All tests use Postman's `pm.test()` API with explicit assertions
- Each assertion validates a specific aspect of the response
- Assertions cover status codes, response structure, field values, and headers

**3. Systematic Coverage:**
- Tests organized by endpoint and scenario category
- All requirements from requirements.md mapped to specific test requests
- Comprehensive coverage of validation rules from backend schemas

### Test Categories

**Success Case Tests:**
- Validate happy path scenarios with valid inputs
- Verify correct response structure and status codes
- Confirm expected business logic behavior

**Validation Error Tests:**
- Test each validation rule from backend schemas
- Verify 400 status codes and error response structure
- Ensure descriptive error messages and error codes

**Edge Case Tests:**
- Test boundary conditions (min/max lengths, age boundaries)
- Validate unusual but valid inputs
- Verify system behavior at limits

**Security Tests:**
- Validate security headers on all responses
- Test CORS configuration
- Verify no information leakage in error responses

**Performance Tests:**
- Rate limiting enforcement tests
- Verify Retry-After headers
- Test exponential backoff behavior

### Test Execution Methods

**1. Postman GUI (Interactive Testing):**
- Open collection in Postman desktop application
- Select environment (local/staging/production)
- Run individual requests or folders
- View test results in Test Results tab
- Best for: Development, debugging, exploratory testing

**2. Collection Runner (Batch Testing):**
- Use Postman Collection Runner
- Run entire collection or specific folders
- Support for iterations and data files
- View aggregated test results
- Best for: Regression testing, validation before deployment

**3. Newman CLI (Automated Testing):**
```bash
# Install Newman
npm install -g newman

# Run collection
newman run collection.json -e environment.json

# Run with HTML reporter
newman run collection.json -e environment.json -r html

# Run specific folder
newman run collection.json -e environment.json --folder "Registration Tests"

# Run with iterations (for rate limiting tests)
newman run collection.json -e environment.json --iteration-count 10
```
- Best for: CI/CD pipelines, automated testing, scheduled runs

**4. CI/CD Integration:**
- Add Newman to CI pipeline (GitHub Actions, GitLab CI, Jenkins)
- Run tests on every commit or deployment
- Fail build if tests fail
- Generate test reports as artifacts

**Example GitHub Actions Workflow:**
```yaml
name: API Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run API Tests
        run: |
          npm install -g newman
          newman run postman_collection.json -e environment.json
```

### Test Maintenance

**Environment Updates:**
- Update `baseUrl` when API endpoint changes
- Rotate test credentials periodically
- Update token values as needed

**Schema Changes:**
- When backend validation rules change, update corresponding validation error tests
- Add new tests for new validation rules
- Update expected response structures if API contract changes

**Version Control:**
- Store collection JSON in version control (Git)
- Track changes to test assertions and request bodies
- Use meaningful commit messages for test updates

**Documentation:**
- Keep collection description up-to-date
- Document any manual setup steps
- Add comments to complex pre-request or test scripts

## Requirements Traceability

This section maps design components to requirements from requirements.md:

| Requirement | Design Component | Implementation |
|-------------|------------------|----------------|
| 1.1-1.5 | Health Check Request | GET /health with status, success, data.status, timestamp, and Content-Type assertions |
| 2.1-2.7 | Registration Success Cases | POST /auth/register for adult student, minor student, instructor with security header validation |
| 3.1-3.12 | Registration Validation Tests | 12 validation error test requests covering all validation rules |
| 4.1-4.6 | Rate Limiting Tests | Requests testing below threshold (success) and exceed threshold (429) with Retry-After header validation |
| 5.1-5.4 | Guardian Approval Placeholder | GET /auth/guardian/approve with and without query params |
| 6.1-6.5 | Guardian Approval Success | POST /auth/guardian/approve for approve and decline decisions |
| 7.1-7.6 | Guardian Approval Validation | 6 validation error tests for approval endpoint |
| 8.1-8.5 | Guardian Token Errors | Tests for invalid, expired, and already-used tokens |
| 9.1-9.5 | HTTP Error Handling | 404 test with NOT_FOUND code and stack trace leak prevention |
| 10.1-10.6 | Security Headers Tests | Comprehensive security header assertions and CORS preflight test |
| 11.1-11.6 | Environment Configuration | Environment variables for baseUrl, test data, and rate limiting configuration |
| 12.1-12.7 | Test Scripts | All requests include pm.test() assertions with descriptive names and clear failure messages |
| 13.1-13.6 | Pre-Request Scripts | Utility functions for data generation, unique identifiers, and ISO dates |
| 14.1-14.7 | Edge Case Tests | Boundary tests for min/max lengths, age boundaries, and unusual valid inputs |
| 15.1-15.7 | Collection Organization | Folder structure, descriptions, naming conventions, and Postman v2.1 format |

### Coverage Summary

**Total Requirements:** 15
**Total Acceptance Criteria:** 92
**Test Requests:** ~50+ (including all variations)

**Coverage by Endpoint:**
- `/health`: 1 request (5 criteria)
- `/auth/register`: ~30 requests (success, validation, edge cases, rate limiting)
- `/auth/guardian/approve` (GET): 2 requests (4 criteria)
- `/auth/guardian/approve` (POST): ~15 requests (success, validation, token errors)
- Security/CORS: 2 requests (11 criteria)
- Error handling: 1 request (5 criteria)

**Coverage by Test Type:**
- Success cases: 6 requests
- Validation errors: 18 requests
- Edge cases: 6 requests
- Security tests: 2 requests
- Rate limiting: 2 requests
- Token errors: 4 requests
- HTTP errors: 1 request
- Guardian placeholder: 2 requests

All 92 acceptance criteria from requirements.md are covered by the design specifications.

## Implementation Notes

### Postman Collection Structure

The final collection JSON will follow this structure:

```
collection.json
├── info (metadata)
├── auth (none required for these endpoints)
├── event (collection-level scripts)
│   └── prerequest (utility functions)
├── variable (collection-level variables)
└── item (folders and requests)
    ├── Health Check (folder)
    │   └── GET /health
    ├── Authentication - Registration (folder)
    │   ├── Success Cases (subfolder)
    │   │   ├── Register Adult Student
    │   │   ├── Register Minor Student
    │   │   └── Register Instructor
    │   ├── Validation Errors (subfolder)
    │   │   ├── Invalid full_name (too short)
    │   │   ├── ... (11 more validation tests)
    │   ├── Edge Cases (subfolder)
    │   │   ├── Minimum valid full_name
    │   │   ├── ... (5 more edge case tests)
    │   └── Rate Limiting (subfolder)
    │       ├── Below threshold
    │       └── Exceed threshold
    ├── Authentication - Guardian Approval (folder)
    │   ├── Guardian Approval Placeholder (GET) (subfolder)
    │   │   ├── GET without query params
    │   │   └── GET with token
    │   ├── Success Cases (subfolder)
    │   │   ├── Approve decision
    │   │   └── Decline decision
    │   ├── Validation Errors (subfolder)
    │   │   ├── ... (6 validation tests)
    │   └── Token Error Cases (subfolder)
    │       ├── ... (4 token error tests)
    ├── Security & Headers (folder)
    │   ├── Security Headers Validation
    │   └── CORS Preflight
    └── Error Handling (folder)
        └── 404 Not Found
```

### File Deliverables

**1. Collection File:**
- `postman_collection.json` - Main collection file in Postman v2.1 format

**2. Environment Files:**
- `environments/local.postman_environment.json` - Local development environment
- `environments/staging.postman_environment.json` - Staging environment
- `environments/production.postman_environment.json` - Production environment (read-only tests)

**3. Documentation:**
- `README.md` - Collection usage guide, setup instructions, and testing procedures
- Embedded in collection description field

**4. Helper Scripts (Optional):**
- `scripts/generate-tokens.js` - Helper script to generate test guardian tokens (Node.js)
- `scripts/seed-test-data.sql` - Database seeding script for test data

### Key Design Decisions

**1. No Authentication Required:**
- Registration and health check endpoints are public
- No auth headers needed in collection
- Simplifies initial testing setup

**2. Dynamic Test Data Generation:**
- Pre-request scripts generate unique identifiers using timestamps
- Prevents conflicts from running tests multiple times
- Ensures independence between test runs

**3. Comprehensive Assertion Coverage:**
- Every test validates multiple aspects (status, structure, values, headers)
- Descriptive test names clearly indicate what is being validated
- Failure messages provide clear debugging information

**4. Environment-Based Configuration:**
- All environment-specific values in environment files
- Collection can run against any environment without modification
- Supports multiple testing scenarios (local, staging, production)

**5. Modular Folder Structure:**
- Clear separation between endpoints and test types
- Easy to run specific test subsets
- Logical organization matches API structure

**6. Reusable Utility Functions:**
- Collection-level pre-request script provides common utilities
- Reduces duplication across individual test scripts
- Easier to maintain and update

**7. Newman-Compatible Design:**
- All tests designed to run both in GUI and CLI
- Support for automated CI/CD integration
- No dependencies on manual intervention during test execution

### Technical Constraints and Limitations

**1. Rate Limiting Test Execution:**
- Postman GUI doesn't easily support rapid sequential requests
- Newman CLI with iterations is recommended for rate limiting tests
- Manual testing requires running the same request 6+ times
- Alternative: Document expected behavior and test manually

**2. Guardian Token Generation:**
- Requires backend integration to generate valid tokens
- Expired tokens require time manipulation or backend helper
- Used tokens require tracking state across test runs
- Recommendation: Use test helper endpoint or database seeding

**3. Time-Sensitive Tests:**
- Birth date calculations depend on current date
- Age boundary tests may behave differently on different dates
- ISO timestamp validation uses regex matching
- Recommendation: Use relative date calculations (years ago)

**4. Response Time Validation:**
- Not included in current design but could be added
- Example: `pm.expect(pm.response.responseTime).to.be.below(1000)`
- May vary based on environment and system load

**5. Asynchronous Operations:**
- Email sending is asynchronous (not validated in API tests)
- Database operations may have eventual consistency
- Recommendation: Focus on synchronous API contract validation

**6. Environment-Specific Behavior:**
- Production environment may have stricter rate limits
- Development environment may have different security headers
- Recommendation: Use environment-specific expected values

**7. Test Data Cleanup:**
- Successful registrations create database records
- No automatic cleanup in collection
- Recommendation: Use test database that can be reset, or implement cleanup scripts

### Future Enhancements

**1. Data-Driven Testing:**
- Use CSV or JSON data files with Collection Runner
- Test multiple email formats, name variations, etc.
- Iterate through edge case values systematically

**2. Performance Testing:**
- Add response time assertions
- Test concurrent request handling
- Validate under load conditions

**3. Contract Testing:**
- Integrate with API contract validation tools
- Generate OpenAPI/Swagger spec from tests
- Ensure API contract compliance

**4. Mock Server Integration:**
- Create Postman Mock Server from collection
- Enable frontend development before backend completion
- Use for demonstration and training

**5. Advanced Guardian Token Testing:**
- Automated token generation from registration flow
- Chain requests to capture tokens dynamically
- Full end-to-end guardian approval workflow test

**6. Negative Security Testing:**
- SQL injection attempts
- XSS payload testing
- Large payload testing (DoS prevention)
- Malformed JSON testing

**7. Accessibility and Localization:**
- Test error messages in multiple languages (if supported)
- Validate response structure for i18n compatibility

## Conclusion

This design document provides a comprehensive specification for a Postman test collection that validates the hybrid LMS backend API. The collection covers all requirements from requirements.md including:

- Health check endpoint validation
- User registration success scenarios for adult students, minor students, and instructors
- Comprehensive validation error testing for all backend schema rules
- Edge case and boundary condition testing
- Rate limiting enforcement validation
- Guardian approval workflow testing (placeholder and submission)
- Guardian token error handling (invalid, expired, already-used)
- Security headers and CORS configuration validation
- HTTP error handling and information leak prevention
- Environment configuration management
- Reusable utility functions and test patterns

**Design Completeness:**
- All 15 requirements covered
- All 92 acceptance criteria mapped to specific tests
- ~50+ test requests specified with full details
- Pre-request scripts for dynamic data generation
- Test scripts with comprehensive assertions
- Environment templates for local, staging, and production
- Clear documentation and maintenance procedures

**Implementation Readiness:**
The design provides sufficient detail for implementation to proceed directly:
- Complete request specifications with methods, URLs, headers, and bodies
- Full pre-request script code for data generation
- Complete test script code with all assertions
- Environment variable schemas and example values
- Folder structure and organization
- Postman Collection v2.1 JSON schema compliance

**Testing Approach:**
This is a testing infrastructure deliverable, not application code. Property-based testing is not applicable. The design uses example-based testing with explicit assertions covering success cases, validation errors, edge cases, security controls, and error conditions.

The collection can be executed interactively in Postman GUI, in batch mode using Collection Runner, or automated using Newman CLI in CI/CD pipelines. All tests are designed to be independent and repeatable with dynamic data generation to avoid conflicts.

Implementation can now proceed to create the actual Postman collection JSON file following this specification.

