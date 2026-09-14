# Integration Tests

This directory contains integration tests that run against the actual Brightspace API.

## ⚠️ Warning: Credentials Required

Integration tests require a valid MUN account with enrolled courses. They will:
- Authenticate with Brightspace
- Read real course data
- Verify API endpoints and data transformations

**Only run these tests if you:**
- Have a valid MUN account
- Are authorized to access test course data
- Understand the privacy implications
- Have network access to `online.mun.ca`

## Setup

### 1. Authenticate

Before running integration tests, you must have an active session:

```powershell
npm run login
```

This creates an encrypted session stored in Windows Credential Manager.

### 2. Identify test courses

Find course IDs you're willing to use for testing:

```powershell
npm run smoke -- --live
```

This lists your courses. Note the course IDs for courses you can test with.

### 3. Set environment variables (optional, for CI/CD)

If running in GitHub Actions or another CI environment, set:

```powershell
$env:MUN_D2L_TEST_COURSE_ID = "123456"     # A course ID to test
$env:MUN_D2L_TEST_WITH_NETWORK = "true"    # Allow real Brightspace calls
```

## Running integration tests

### Local testing (interactive)

```powershell
# Run all integration tests against Brightspace
npm test -- tests/integration/

# Run a specific test file
npm test -- tests/integration/courses.test.mjs

# Run with verbose output
npm test -- tests/integration/ --reporter=verbose
```

### CI/CD testing (automated)

In GitHub Actions, integration tests should:
1. Skip unless explicitly enabled
2. Use a service account or test credentials (if applicable)
3. Never commit credentials to the repository
4. Clean up after themselves

Example CI configuration (use secrets for credentials):

```yaml
- name: Run integration tests
  if: github.event_name == 'workflow_dispatch'
  env:
    MUN_D2L_TEST_WITH_NETWORK: 'true'
    MUN_D2L_TEST_COURSE_ID: ${{ secrets.TEST_COURSE_ID }}
  run: npm test -- tests/integration/
```

## Test structure

### courses.test.mjs

**Purpose**: Verify `list_courses` endpoint and data transformation

**What it tests**:
- [ ] Fetch current enrollments
- [ ] Verify course object structure (id, name, code, access)
- [ ] Handle enrollments with and without access
- [ ] Pagination (if 50+ courses)

**Prerequisites**: Active Brightspace session

**Expected**: Returns list of courses with ids, names, codes, and access status

---

### assignments.test.mjs

**Purpose**: Verify assignment listing and data transformation

**What it tests**:
- [ ] List assignments for a test course
- [ ] Verify assignment structure (id, name, due_date, etc.)
- [ ] Handle assignments with no due date
- [ ] Verify release status and visibility
- [ ] Check attachment metadata

**Prerequisites**: Active session, course ID with assignments

**Expected**: Returns structured assignment list with dates and metadata

---

### grades.test.mjs

**Purpose**: Verify grade fetching and calculations

**What it tests**:
- [ ] Fetch grades for a course
- [ ] Verify grade structure (value, category, release status)
- [ ] Handle missing/unreleased grades
- [ ] Verify category summaries are separate from scores
- [ ] Check that no overall grade is calculated

**Prerequisites**: Active session, course ID with grades

**Expected**: Returns grade data without inferring unreleased or missing grades as zero

---

### materials.test.mjs

**Purpose**: Verify material reading and text extraction

**What it tests**:
- [ ] List course modules and topics
- [ ] Read material from supported formats (PDF, HTML, text)
- [ ] Verify text extraction quality
- [ ] Handle locked topics
- [ ] Check pagination for large documents
- [ ] Verify offset/max_characters work correctly

**Prerequisites**: Active session, course ID with readable materials

**Expected**: Returns extracted text with source links and character limits respected

---

### deadlines.test.mjs

**Purpose**: Verify deadline aggregation across courses

**What it tests**:
- [ ] Get upcoming deadlines (default 7 days)
- [ ] Verify date range filtering (inclusive start, exclusive end)
- [ ] Handle assignments with no due date (use close date)
- [ ] Check deadline completeness flag
- [ ] Verify timezone handling (America/St_Johns)
- [ ] Test custom date ranges

**Prerequisites**: Active session, multiple courses with deadlines

**Expected**: Returns sorted, filtered deadline list with clear status indicators

---

## Writing new integration tests

Use this template:

```javascript
// tests/integration/example.test.mjs
import { describe, it, expect, beforeAll } from 'vitest';
import { listCourses } from '../../dist/api.js';

describe('Example Integration Test', () => {
  let courseId;

  beforeAll(async () => {
    // Get a test course ID
    const courses = await listCourses();
    if (courses.length === 0) {
      throw new Error('No test courses available');
    }
    courseId = courses[0].id;
  });

  it('should fetch and transform course data', async () => {
    const result = await listCourses();
    
    // Verify structure
    expect(result).toBeInstanceOf(Array);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    
    // Verify no sensitive data leaked
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('token');
  });
});
```

**Best practices**:
- Use `beforeAll` to set up test data (session, course IDs)
- Verify data structure matches documented API
- Check for credential leaks in output
- Never hardcode course IDs—fetch them dynamically
- Clean up any state changes (optional, since tests are read-only)
- Skip tests if prerequisites aren't available

## Troubleshooting integration tests

### Test fails: `AUTH_REQUIRED`

The session expired. Re-authenticate:

```powershell
npm run login
npm test -- tests/integration/
```

### Test fails: `NOT_FOUND`

The course or resource doesn't exist anymore. Get a new test course:

```powershell
npm run smoke -- --live     # Lists your courses
# Update test course ID
```

### Test hangs or times out

Network or Brightspace issue:

1. Verify Brightspace is accessible: `npm run doctor`
2. Check your network connection
3. Try again after a few minutes

### Test output includes sensitive data

⚠️ **Never commit test output with grades, course content, or personal data.**

Redact before sharing:

```powershell
npm test -- tests/integration/ 2>&1 | Select-String -NotMatch "course|grade|assignment"
```

## CI/CD best practices

### Never store credentials in CI

Use GitHub Secrets or a service account:

```yaml
env:
  # ❌ DON'T DO THIS
  PASSWORD: "real_password"

  # ✓ DO THIS
  TEST_ACCOUNT: ${{ secrets.TEST_ACCOUNT }}
```

### Skip integration tests by default

In your CI workflow, integration tests should only run:
- On manual trigger (`workflow_dispatch`)
- On specific branches (not every PR)
- With explicit opt-in

```yaml
- name: Run integration tests
  if: github.event_name == 'workflow_dispatch'
  run: npm test -- tests/integration/
```

### Clean up after tests

Even though tests are read-only, ensure no session data leaks:

```powershell
npm run logout  # Clean session after testing (optional)
```

## Documentation

When adding new API endpoints to the server, write corresponding integration tests to verify:
- The endpoint structure matches the documentation
- Data transformations are correct
- Errors are handled properly
- No sensitive data is leaked

Link your integration tests in the endpoint documentation:
> See `tests/integration/example.test.mjs` for real-world usage examples.
