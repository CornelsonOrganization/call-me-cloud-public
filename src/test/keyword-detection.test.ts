import { describe, it } from 'node:test'
import assert from 'node:assert'
import { detectCallRequest } from '../keyword-detection.js'

describe('Keyword Detection', () => {
  describe('Exact matches', () => {
    it('should detect "call" as a call request', () => {
      assert.strictEqual(detectCallRequest('call'), true)
    })

    it('should detect "call me" as a call request', () => {
      assert.strictEqual(detectCallRequest('call me'), true)
    })

    it('should detect "Call Me" (case insensitive) as a call request', () => {
      assert.strictEqual(detectCallRequest('Call Me'), true)
    })

    it('should detect "CALL ME" (uppercase) as a call request', () => {
      assert.strictEqual(detectCallRequest('CALL ME'), true)
    })

    it('should detect "phone" as a call request', () => {
      assert.strictEqual(detectCallRequest('phone'), true)
    })

    it('should detect "phone me" as a call request', () => {
      assert.strictEqual(detectCallRequest('phone me'), true)
    })

    it('should detect "ring me" as a call request', () => {
      assert.strictEqual(detectCallRequest('ring me'), true)
    })
  })

  describe('Pattern matches at start of message', () => {
    it('should detect "call me please"', () => {
      assert.strictEqual(detectCallRequest('call me please'), true)
    })

    it('should detect "Call me when you can"', () => {
      assert.strictEqual(detectCallRequest('Call me when you can'), true)
    })

    it('should detect "please call"', () => {
      assert.strictEqual(detectCallRequest('please call'), true)
    })

    it('should detect "please call me"', () => {
      assert.strictEqual(detectCallRequest('please call me'), true)
    })

    it('should detect "can you call"', () => {
      assert.strictEqual(detectCallRequest('can you call'), true)
    })

    it('should detect "can you call me"', () => {
      assert.strictEqual(detectCallRequest('can you call me'), true)
    })

    it('should detect "could you call"', () => {
      assert.strictEqual(detectCallRequest('could you call'), true)
    })

    it('should detect "call now"', () => {
      assert.strictEqual(detectCallRequest('call now'), true)
    })

    it('should detect "phone me please"', () => {
      assert.strictEqual(detectCallRequest('phone me please'), true)
    })

    it('should detect "ring me" (British English)', () => {
      assert.strictEqual(detectCallRequest('ring me'), true)
    })
  })

  describe('False positive prevention', () => {
    it('should NOT detect "I\'ll call you back" (user will call)', () => {
      assert.strictEqual(detectCallRequest("I'll call you back"), false)
    })

    it('should NOT detect "I will call you later"', () => {
      assert.strictEqual(detectCallRequest('I will call you later'), false)
    })

    it('should NOT detect "recall that we discussed"', () => {
      assert.strictEqual(detectCallRequest('recall that we discussed'), false)
    })

    it('should NOT detect "escalate this issue"', () => {
      assert.strictEqual(detectCallRequest('escalate this issue'), false)
    })

    it('should NOT detect "basically what happened was"', () => {
      assert.strictEqual(detectCallRequest('basically what happened was'), false)
    })

    it('should NOT detect "politically speaking"', () => {
      assert.strictEqual(detectCallRequest('politically speaking'), false)
    })

    it('should NOT detect "the caller ID showed"', () => {
      assert.strictEqual(detectCallRequest('the caller ID showed'), false)
    })

    it('should NOT detect "recalling our conversation"', () => {
      assert.strictEqual(detectCallRequest('recalling our conversation'), false)
    })
  })

  describe('Edge cases', () => {
    it('should NOT detect empty string', () => {
      assert.strictEqual(detectCallRequest(''), false)
    })

    it('should NOT detect whitespace-only string', () => {
      assert.strictEqual(detectCallRequest('   '), false)
    })

    it('should NOT detect unrelated message "hi there"', () => {
      assert.strictEqual(detectCallRequest('hi there'), false)
    })

    it('should NOT detect unrelated message "thanks!"', () => {
      assert.strictEqual(detectCallRequest('thanks!'), false)
    })

    it('should trim whitespace before checking', () => {
      assert.strictEqual(detectCallRequest('  call me  '), true)
    })
  })
})
