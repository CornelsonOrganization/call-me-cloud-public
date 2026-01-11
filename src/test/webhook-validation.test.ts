import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  validateWhatsAppMessage,
  isValidConversationSid,
  isValidMessageSid,
  isValidWhatsAppNumber,
  hashForLogging,
} from '../webhook-validation.js'

describe('Webhook Validation', () => {
  describe('validateWhatsAppMessage', () => {
    it('should validate a correct message', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: 'Hello, this is a test message',
      })

      assert.strictEqual(result.valid, true)
      assert.strictEqual(result.sanitized, 'Hello, this is a test message')
      assert.strictEqual(result.error, undefined)
    })

    it('should reject message without ConversationSid', () => {
      const result = validateWhatsAppMessage({
        Author: 'whatsapp:+14155551234',
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Missing required fields')
    })

    it('should reject message without Author', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Missing required fields')
    })

    it('should reject message without Body', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Missing required fields')
    })

    it('should reject empty message after trimming', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: '   ',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Empty message')
    })

    it('should reject message exceeding max length', () => {
      const longMessage = 'a'.repeat(65537) // 64KB + 1
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: longMessage,
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Message too long')
    })

    it('should sanitize control characters', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: 'Hello\x00World\x1FTest', // Contains null byte and control char
      })

      assert.strictEqual(result.valid, true)
      assert.strictEqual(result.sanitized, 'HelloWorldTest')
    })

    it('should preserve newlines and tabs', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: 'Line 1\nLine 2\tTabbed',
      })

      assert.strictEqual(result.valid, true)
      assert.strictEqual(result.sanitized, 'Line 1\nLine 2\tTabbed')
    })

    it('should reject invalid ConversationSid format', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'INVALID_SID',
        Author: 'whatsapp:+14155551234',
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Invalid conversation/message SID format')
    })

    it('should reject invalid Author format', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'CH01234567890123456789012345678901',
        Author: '+14155551234', // Missing "whatsapp:" prefix
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, false)
      assert.strictEqual(result.error, 'Invalid author format')
    })

    it('should accept MessageSid format (SM prefix)', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'SM01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, true)
    })

    it('should accept MessageSid format (IM prefix)', () => {
      const result = validateWhatsAppMessage({
        ConversationSid: 'IM01234567890123456789012345678901',
        Author: 'whatsapp:+14155551234',
        Body: 'Test message',
      })

      assert.strictEqual(result.valid, true)
    })
  })

  describe('isValidConversationSid', () => {
    it('should accept valid ConversationSid', () => {
      assert.strictEqual(
        isValidConversationSid('CH01234567890123456789012345678901'),
        true
      )
    })

    it('should accept ConversationSid with uppercase hex', () => {
      assert.strictEqual(
        isValidConversationSid('CHAB234567890123456789012345678901'),
        true
      )
    })

    it('should accept ConversationSid with lowercase hex', () => {
      assert.strictEqual(
        isValidConversationSid('CHab234567890123456789012345678901'),
        true
      )
    })

    it('should reject SID without CH prefix', () => {
      assert.strictEqual(
        isValidConversationSid('AB01234567890123456789012345678901'),
        false
      )
    })

    it('should reject SID with wrong length', () => {
      assert.strictEqual(isValidConversationSid('CH0123456789'), false)
    })

    it('should reject SID with non-hex characters', () => {
      assert.strictEqual(
        isValidConversationSid('CHZZ234567890123456789012345678901'),
        false
      )
    })
  })

  describe('isValidMessageSid', () => {
    it('should accept valid MessageSid with SM prefix', () => {
      assert.strictEqual(
        isValidMessageSid('SM01234567890123456789012345678901'),
        true
      )
    })

    it('should accept valid MessageSid with IM prefix', () => {
      assert.strictEqual(
        isValidMessageSid('IM01234567890123456789012345678901'),
        true
      )
    })

    it('should accept valid MessageSid with MM prefix', () => {
      assert.strictEqual(
        isValidMessageSid('MM01234567890123456789012345678901'),
        true
      )
    })

    it('should reject SID without valid prefix', () => {
      assert.strictEqual(
        isValidMessageSid('AB01234567890123456789012345678901'),
        false
      )
    })

    it('should reject SID with wrong length', () => {
      assert.strictEqual(isValidMessageSid('SM0123456789'), false)
    })
  })

  describe('isValidWhatsAppNumber', () => {
    it('should accept valid US number', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+14155551234'), true)
    })

    it('should accept valid UK number', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+447911123456'), true)
    })

    it('should accept 7-digit number (minimum)', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+1234567'), true)
    })

    it('should accept 15-digit number (maximum)', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+123456789012345'), true)
    })

    it('should reject number without whatsapp: prefix', () => {
      assert.strictEqual(isValidWhatsAppNumber('+14155551234'), false)
    })

    it('should reject number without + sign', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:14155551234'), false)
    })

    it('should reject number starting with 0', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+0123456789'), false)
    })

    it('should reject number with too few digits', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+123456'), false)
    })

    it('should reject number with too many digits', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+1234567890123456'), false)
    })

    it('should reject number with non-numeric characters', () => {
      assert.strictEqual(isValidWhatsAppNumber('whatsapp:+1415ABC1234'), false)
    })
  })

  describe('hashForLogging', () => {
    it('should hash a string consistently', () => {
      const hash1 = hashForLogging('test-string')
      const hash2 = hashForLogging('test-string')
      assert.strictEqual(hash1, hash2)
    })

    it('should produce different hashes for different strings', () => {
      const hash1 = hashForLogging('string-one')
      const hash2 = hashForLogging('string-two')
      assert.notStrictEqual(hash1, hash2)
    })

    it('should start with ***', () => {
      const hash = hashForLogging('any-string')
      assert.strictEqual(hash.startsWith('***'), true)
    })

    it('should return hexadecimal string after ***', () => {
      const hash = hashForLogging('test')
      const hexPart = hash.substring(3)
      assert.match(hexPart, /^[0-9a-f]+$/)
    })
  })
})
