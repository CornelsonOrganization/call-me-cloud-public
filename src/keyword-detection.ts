/**
 * Keyword Detection - Detect when user wants to switch from WhatsApp to voice call
 *
 * SECURITY: Uses restrictive patterns to prevent false positives
 *
 * Philosophy:
 * - Better to miss a call request than to trigger false positives
 * - Patterns must match at START of message only
 * - "call me" → TRUE (user wants call)
 * - "I'll call you back" → FALSE (not a request for Claude to call)
 * - "recall that we discussed" → FALSE (not related to phone calls)
 */

/**
 * Call request patterns (start of message only)
 *
 * All patterns use:
 * - ^ anchor (start of string)
 * - \b word boundary (prevents matching substrings)
 * - Case-insensitive flag
 *
 * SECURITY: Restrictive by design to prevent false positives
 */
const CALL_REQUEST_PATTERNS = [
  /^call me\b/i,           // "call me"
  /^please call\b/i,       // "please call"
  /^can you call\b/i,      // "can you call"
  /^could you call\b/i,    // "could you call"
  /^call now\b/i,          // "call now"
  /^phone me\b/i,          // "phone me"
  /^please phone\b/i,      // "please phone"
  /^ring me\b/i,           // "ring me" (British English)
];

/**
 * Exact matches (case-insensitive, no additional text)
 *
 * Short, unambiguous commands that clearly request a call
 */
const EXACT_CALL_MATCHES = [
  'call',
  'call me',
  'phone',
  'phone me',
  'ring',
  'ring me',
];

/**
 * Detect if message is requesting a phone call
 *
 * Uses two-tier detection:
 * 1. Exact matches (most reliable)
 * 2. Pattern matches at start of message (reliable)
 *
 * EXAMPLES:
 * - "call me" → TRUE
 * - "Call me please" → TRUE
 * - "please call when you can" → TRUE
 * - "I'll call you back" → FALSE (user will call, not requesting a call)
 * - "recall that we discussed" → FALSE (contains "call" but not a request)
 * - "escalate this issue" → FALSE (contains "call" but not a request)
 *
 * @param message User's message from WhatsApp
 * @returns true if message requests a call, false otherwise
 */
export function detectCallRequest(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  // Check for exact matches (most reliable)
  if (EXACT_CALL_MATCHES.includes(trimmed)) {
    return true;
  }

  // Check for pattern matches (must be at start of message)
  for (const pattern of CALL_REQUEST_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Test cases for keyword detection
 *
 * Run with: npm test (once tests are written)
 * Or manually verify with: node -e "import('./keyword-detection.js').then(m => console.log(m.runTests()))"
 */
export function runTests(): boolean {
  const tests: Array<[string, boolean]> = [
    // Exact matches - should trigger
    ['call', true],
    ['call me', true],
    ['Call Me', true],
    ['CALL ME', true],
    ['phone', true],
    ['phone me', true],

    // Pattern matches at start - should trigger
    ['call me please', true],
    ['Call me when you can', true],
    ['please call', true],
    ['please call me', true],
    ['can you call', true],
    ['can you call me', true],
    ['could you call', true],
    ['call now', true],
    ['phone me please', true],
    ['ring me', true],

    // False positives - should NOT trigger
    ["I'll call you back", false],
    ["I will call you later", false],
    ['recall that we discussed', false],
    ['escalate this issue', false],
    ['basically what happened was', false],
    ['politically speaking', false],
    ['the caller ID showed', false],
    ['recalling our conversation', false],

    // Edge cases - should NOT trigger
    ['', false],
    ['   ', false],
    ['hi there', false],
    ['thanks!', false],
  ];

  let passed = 0;
  let failed = 0;

  for (const [input, expected] of tests) {
    const result = detectCallRequest(input);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: "${input}" → ${result} (expected ${expected})`);
    }
  }

  console.error(`Tests: ${passed} passed, ${failed} failed`);
  return failed === 0;
}
