# Implementation Plan: Postman Test Collection for Hybrid LMS Backend

## Overview

This implementation plan creates a comprehensive Postman Collection v2.1 JSON file that tests the hybrid LMS backend API. The collection will include automated tests for health check, user registration (success, validation, edge cases), rate limiting, guardian approval (placeholder GET endpoint and POST submission), security headers, CORS, and error handling. The implementation follows the structure defined in the design document with organized folders, reusable utility scripts, and environment configuration files.

## Tasks

- [ ] 1. Initialize collection structure and metadata
  - Create the root collection JSON file with Postman v2.1 schema
  - Define collection metadata (name, description, version)
  - Set up empty item array for requests/folders
  - Set up variable array for collection-level variables
  - Set up event array for collection-level scripts
  - _Requirements: 11.1, 15.1, 15.7_

- [ ] 2. Create collection-level configuration
  - [~] 2.1 Define collection-level variables
    - Add `baseUrl` variable (default: `http://localhost:3000/api/v1`)
    - Add `timestamp`, `randomEmail`, `randomPassword` variables
    - Add `testGuardianToken` variable
    - _Requirements: 11.1, 11.2_
  
  - [~] 2.2 Write collection-level pre-request script
    - Implement timestamp generation utility
    - Implement unique email generation utility
    - Implement password generation utility
    - Implement `generateAdultBirthDate()` function
    - Implement `generateMinorBirthDate()` function
    - Implement `generateBirthDateDaysAgo()` function
    - Store utilities in global variables for reuse
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6_

- [ ] 3. Create environment template files
  - [~] 3.1 Create local development environment file
    - Define `baseUrl` for local environment
    - Define test data variables with `.local` suffix
    - Define rate limit configuration variables
    - Save as `environments/local.postman_environment.json`
    - _Requirements: 11.2, 11.3, 11.5_
  
  - [~] 3.2 Create staging environment file
    - Define `baseUrl` for staging environment
    - Define test data variables with `.staging` suffix
    - Define rate limit configuration variables
    - Save as `environments/staging.postman_environment.json`
    - _Requirements: 11.2, 11.3, 11.5_
  
  - [~] 3.3 Create production environment file
    - Define `baseUrl` for production environment
    - Define read-only test configuration
    - Save as `environments/production.postman_environment.json`
    - _Requirements: 11.2, 11.3, 11.5_

- [ ] 4. Implement health check endpoint test
  - [~] 4.1 Create Health Check folder and request
    - Add "Health Check" folder to collection
    - Create GET /health request with URL `{{baseUrl}}/health`
    - _Requirements: 1.1, 15.1, 15.4_
  
  - [~] 4.2 Write health check test assertions
    - Assert status code is 200
    - Assert response has `success=true`
    - Assert response has `data` property
    - Assert `data.status` is "ok"
    - Assert `data.timestamp` is valid ISO 8601 format
    - Assert Content-Type is application/json
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [~] 5. Checkpoint - Verify health check test works
  - Ensure the health check test runs successfully, ask the user if questions arise.

- [ ] 6. Implement registration success case tests
  - [~] 6.1 Create Registration folder structure
    - Add "Authentication - Registration" folder to collection
    - Add "Success Cases" subfolder
    - _Requirements: 15.1, 15.5_
  
  - [~] 6.2 Create adult student registration test
    - Create POST /auth/register request
    - Write pre-request script to generate unique adult test data (18+ years)
    - Define JSON request body with adult birth_date
    - Write test assertions for 201 status, success=true, verification email message
    - Assert `requires_guardian_approval` is not present
    - Assert security headers are present (CSP, X-Content-Type-Options, X-Frame-Options, HSTS)
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 12.1, 12.2, 12.4, 13.1, 13.2_
  
  - [~] 6.3 Create minor student registration test
    - Create POST /auth/register request for minor (under 18)
    - Write pre-request script to generate unique minor test data (17 years old)
    - Define JSON request body with minor birth_date and guardian_email
    - Write test assertions for 201 status, success=true
    - Assert `requires_guardian_approval=true`
    - Assert message mentions guardian approval
    - _Requirements: 2.4, 2.5, 12.1, 12.2, 12.4, 13.1, 13.2_
  
  - [~] 6.4 Create instructor registration test
    - Create POST /auth/register request for instructor role
    - Write pre-request script to generate unique instructor test data
    - Define JSON request body with role="Instructor"
    - Write test assertions for 201 status, success=true, verification email message
    - _Requirements: 2.6, 12.1, 12.2, 12.4, 13.1, 13.2_

- [ ] 7. Implement registration validation error tests
  - [~] 7.1 Create Validation Errors subfolder
    - Add "Validation Errors" subfolder under Authentication - Registration
    - _Requirements: 15.1, 15.5_
  
  - [~] 7.2 Create full_name validation error tests
    - Create test for full_name too short (1 character)
    - Create test for full_name too long (101 characters)
    - Write common error assertion pattern: status 400, success=false, error.code, error.message
    - _Requirements: 3.1, 3.2, 3.12, 12.1, 12.2, 12.3, 12.4, 12.7_
  
  - [~] 7.3 Create email validation error tests
    - Create test for invalid email format ("invalid-email")
    - Write assertions for 400 status and error structure
    - _Requirements: 3.3, 3.12, 12.1, 12.2, 12.7_
  
  - [~] 7.4 Create password validation error tests
    - Create test for password too short (14 characters)
    - Create test for blocklisted password ("password123456")
    - Write assertions for 400 status and error structure
    - _Requirements: 3.4, 3.5, 3.12, 12.1, 12.2, 12.7_
  
  - [~] 7.5 Create birth_date validation error tests
    - Create test for invalid birth_date format ("01/01/2000")
    - Create test for invalid birth_date value ("2000-13-45")
    - Write assertions for 400 status and error structure
    - _Requirements: 3.6, 3.7, 3.12, 12.1, 12.2, 12.7_
  
  - [~] 7.6 Create role and guardian validation error tests
    - Create test for invalid role enum ("Admin")
    - Create test for minor without guardian_email
    - Create test for guardian_email equals email
    - Create test for missing required fields
    - Write assertions for 400 status and error structure for each
    - _Requirements: 3.8, 3.9, 3.10, 3.11, 3.12, 12.1, 12.2, 12.7_

- [ ] 8. Implement registration edge case tests
  - [~] 8.1 Create Edge Cases subfolder
    - Add "Edge Cases" subfolder under Authentication - Registration
    - _Requirements: 15.1, 15.5_
  
  - [~] 8.2 Create boundary length tests
    - Create test for minimum valid full_name (2 characters)
    - Create test for maximum valid full_name (100 characters)
    - Create test for minimum valid password (15 characters)
    - Write assertions for 201 status (accepts boundary values)
    - _Requirements: 14.1, 14.2, 14.3, 12.1, 12.4_
  
  - [~] 8.3 Create age boundary tests
    - Create test for birth_date exactly 18 years ago
    - Write pre-request script to calculate exact boundary date
    - Create test for birth_date 17 years 364 days ago (clearly minor)
    - Write pre-request script to calculate minor boundary date
    - Write assertions for appropriate responses (adult vs. minor)
    - _Requirements: 14.4, 14.5, 12.1, 12.4, 13.2_
  
  - [~] 8.4 Create unusual email format test
    - Create test for unusual but valid email formats
    - Write assertions for 201 status (accepts valid unusual formats)
    - _Requirements: 14.6, 12.1, 12.4_

- [ ] 9. Implement rate limiting tests
  - [~] 9.1 Create Rate Limiting subfolder
    - Add "Rate Limiting" subfolder under Authentication - Registration
    - _Requirements: 15.1, 15.5_
  
  - [~] 9.2 Create below threshold success test
    - Create POST /auth/register request for rate limit testing
    - Write pre-request script with unique identifier
    - Write assertions for 201 status (below threshold succeeds)
    - Document that this is the first of multiple sequential requests
    - _Requirements: 4.5, 4.6, 12.1, 12.4_
  
  - [~] 9.3 Create exceed threshold error test
    - Create POST /auth/register request for rate limit burst test
    - Write pre-request script using same identifier as previous test
    - Write assertions for 429 status
    - Assert error.code is "RATE_LIMITED"
    - Assert Retry-After header is present
    - Assert Retry-After header contains positive integer
    - Document that this requires 6+ sequential requests with same identifier
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 12.1, 12.2, 12.3, 12.4, 12.7_

- [~] 10. Checkpoint - Verify registration tests work
  - Ensure all registration tests (success, validation, edge cases, rate limiting) pass, ask the user if questions arise.

- [ ] 11. Implement guardian approval placeholder GET tests
  - [~] 11.1 Create Guardian Approval folder structure
    - Add "Authentication - Guardian Approval" folder to collection
    - Add "Guardian Approval Placeholder (GET)" subfolder
    - _Requirements: 15.1, 15.5_
  
  - [~] 11.2 Create GET without query params test
    - Create GET /auth/guardian/approve request
    - Write test assertions for 200 status, success=true
    - Assert `token_received=false`
    - Assert message indicates placeholder
    - _Requirements: 5.1, 5.2, 5.4, 12.1, 12.2, 12.4_
  
  - [~] 11.3 Create GET with token query param test
    - Create GET /auth/guardian/approve?token=test123 request
    - Write test assertions for 200 status, success=true
    - Assert `token_received=true`
    - _Requirements: 5.3, 12.1, 12.2, 12.4_

- [ ] 12. Implement guardian approval POST success tests
  - [~] 12.1 Create Success Cases subfolder
    - Add "Success Cases" subfolder under Authentication - Guardian Approval
    - _Requirements: 15.1, 15.5_
  
  - [~] 12.2 Create approve decision test
    - Create POST /auth/guardian/approve request
    - Write pre-request script to use valid token from environment
    - Define JSON request body with decision="approve", consent=true
    - Write assertions for 200 status, success=true
    - Assert response has status field with valid workflow state
    - Assert message indicates approval
    - _Requirements: 6.1, 6.2, 6.5, 12.1, 12.2, 12.4, 13.4_
  
  - [~] 12.3 Create decline decision test
    - Create POST /auth/guardian/approve request for decline
    - Write pre-request script to use valid token from environment
    - Define JSON request body with decision="decline"
    - Write assertions for 200 status, success=true
    - Assert message indicates decline
    - _Requirements: 6.3, 6.4, 12.1, 12.2, 12.4, 13.4_

- [ ] 13. Implement guardian approval validation error tests
  - [~] 13.1 Create Validation Errors subfolder
    - Add "Validation Errors" subfolder under Authentication - Guardian Approval
    - _Requirements: 15.1, 15.5_
  
  - [~] 13.2 Create missing/invalid field validation tests
    - Create test for missing token
    - Create test for invalid decision value ("maybe")
    - Create test for missing guardian_full_name
    - Create test for invalid relationship value ("uncle")
    - Create test for approve without consent=true
    - Create test for missing multiple required fields
    - Write common error assertion pattern for each: status 400, success=false, error property
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.1, 12.2, 12.3, 12.7_

- [ ] 14. Implement guardian approval token error tests
  - [~] 14.1 Create Token Error Cases subfolder
    - Add "Token Error Cases" subfolder under Authentication - Guardian Approval
    - _Requirements: 15.1, 15.5_
  
  - [~] 14.2 Create invalid token format test
    - Create POST request with malformed token ("invalid-malformed-token")
    - Write assertions for 400 status, success=false
    - Assert error.code is "TOKEN_INVALID"
    - Assert error message describes invalid token
    - _Requirements: 8.1, 8.2, 8.5, 12.1, 12.2, 12.3, 12.4, 12.7_
  
  - [~] 14.3 Create already-used token test
    - Create POST request using pre-configured used token from environment
    - Write pre-request script to retrieve used token
    - Write assertions for 400 status, success=false
    - Assert error.code is "TOKEN_ALREADY_USED"
    - Assert error message describes already used token
    - _Requirements: 8.3, 8.5, 12.1, 12.2, 12.3, 12.4, 12.7, 13.4_
  
  - [~] 14.4 Create expired token test
    - Create POST request using pre-configured expired token from environment
    - Write pre-request script to retrieve expired token
    - Write assertions for 400 status, success=false
    - Assert error.code is "TOKEN_EXPIRED"
    - Assert error message describes expired token
    - _Requirements: 8.4, 8.5, 12.1, 12.2, 12.3, 12.4, 12.7, 13.4_

- [~] 15. Checkpoint - Verify guardian approval tests work
  - Ensure all guardian approval tests (placeholder GET, success POST, validation, token errors) pass, ask the user if questions arise.

- [ ] 16. Implement security headers and CORS tests
  - [~] 16.1 Create Security & Headers folder
    - Add "Security & Headers" folder to collection
    - _Requirements: 15.1, 15.5_
  
  - [~] 16.2 Create security headers validation test
    - Create GET /health request for comprehensive security header check
    - Write test assertions for Content-Security-Policy header
    - Assert CSP includes "default-src 'self'" and "object-src 'none'"
    - Assert X-Content-Type-Options is "nosniff"
    - Assert X-Frame-Options is "DENY" or "SAMEORIGIN"
    - Assert Strict-Transport-Security header includes "max-age="
    - Assert X-Powered-By header is not present (not exposed)
    - Add meta-test documenting OWASP compliance
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 12.1, 12.3, 12.4_
  
  - [~] 16.3 Create CORS preflight test
    - Create OPTIONS /auth/register request
    - Add Origin, Access-Control-Request-Method, Access-Control-Request-Headers to request headers
    - Write assertions for 200 or 204 status
    - Assert Access-Control-Allow-Origin header is present
    - Assert Access-Control-Allow-Methods header is present
    - Assert Access-Control-Allow-Headers header is present
    - _Requirements: 10.5, 12.1, 12.3, 12.4_

- [ ] 17. Implement error handling tests
  - [~] 17.1 Create Error Handling folder
    - Add "Error Handling" folder to collection
    - _Requirements: 15.1, 15.5_
  
  - [~] 17.2 Create 404 Not Found test
    - Create GET /nonexistent request
    - Write assertions for 404 status, success=false
    - Assert error.code is "NOT_FOUND"
    - Assert error message exists
    - Assert response does not leak stack traces (no "at ", "node_modules", ".js:")
    - Assert response does not leak internal error details (no "Error:", "TypeError:")
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 12.1, 12.2, 12.3, 12.4, 12.7_
  
  - [~] 17.3 Document server error handling expectations
    - Add comment in folder description documenting 500 error expectations
    - Note: Server errors must follow error response structure
    - Note: Server errors must not leak stack traces or internal details
    - Note: Server errors must return success=false
    - _Requirements: 9.4, 9.5, 15.3, 15.6_

- [ ] 18. Create comprehensive README documentation
  - [~] 18.1 Write README.md file
    - Document collection purpose and overview
    - Document setup instructions (import collection, import environment)
    - Document environment variable configuration requirements
    - Document how to run tests (GUI, Collection Runner, Newman CLI)
    - Document special test cases (rate limiting requires 6+ sequential requests)
    - Document guardian token generation requirements (test helper or database seeding)
    - Document Newman CLI usage examples
    - Document CI/CD integration example (GitHub Actions)
    - Document test maintenance procedures
    - Document version control recommendations
    - _Requirements: 11.6, 15.2, 15.3, 15.6_

- [ ] 19. Add collection-level and request-level descriptions
  - [~] 19.1 Write collection-level description
    - Add comprehensive description to collection metadata
    - Include purpose, usage instructions, and environment setup
    - Reference README.md for detailed documentation
    - _Requirements: 15.2, 15.3_
  
  - [~] 19.2 Add request-level descriptions
    - Add description to each request explaining what is being tested
    - Add notes for requests with special requirements (rate limiting, tokens)
    - Add comments in test scripts for complex validation logic
    - _Requirements: 15.3, 15.6_

- [ ] 20. Final validation and export
  - [~] 20.1 Validate collection structure
    - Verify collection follows Postman v2.1 schema
    - Verify all folders and requests are properly nested
    - Verify all variable references use correct syntax
    - Verify all test scripts use valid JavaScript and pm.test() API
    - _Requirements: 15.7_
  
  - [~] 20.2 Test collection execution
    - Import collection into Postman
    - Import local environment file
    - Run entire collection in Collection Runner
    - Verify all tests execute without syntax errors
    - Document any tests that require manual setup (guardian tokens)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  
  - [~] 20.3 Export and organize deliverables
    - Export collection as JSON file: `postman_collection.json`
    - Ensure environment files are in `environments/` directory
    - Ensure README.md is complete
    - Verify all files are ready for version control
    - _Requirements: 15.7, 11.5_

- [~] 21. Final checkpoint - Complete collection validation
  - Ensure the complete Postman collection runs successfully with all tests passing (excluding tests requiring manual token setup), ask the user if questions arise.

## Notes

- **Testing Infrastructure**: This collection is a testing artifact, not application code. No property-based testing is applicable.
- **Test Execution**: Tests can run in Postman GUI, Collection Runner, or Newman CLI. Rate limiting tests work best with Newman using `--iteration-count` flag.
- **Guardian Tokens**: Tests requiring valid guardian tokens need manual setup (database seeding or test helper endpoint in development environment).
- **Environment Variables**: All environment-specific values should be configured in environment files, not hardcoded in requests.
- **Naming Conventions**: Follow consistent naming for folders (sentence case) and requests (descriptive action-oriented names).
- **Test Independence**: Each test should be independent where possible. Use unique identifiers for test data to avoid conflicts.
- **Documentation**: Comprehensive documentation in README.md and embedded in collection descriptions ensures maintainability.
- **Version Control**: Store collection JSON and environment templates in Git for tracking changes over time.
