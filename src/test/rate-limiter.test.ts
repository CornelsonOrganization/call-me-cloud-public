import { describe, it } from 'node:test'
import assert from 'node:assert'
import { RateLimiter } from '../rate-limiter.js'

describe('RateLimiter', () => {
  describe('Global rate limiting', () => {
    it('should allow requests under the global limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 10 },
        perPhone: { windowMs: 60000, maxMessages: 20, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 20 },
      })

      for (let i = 0; i < 10; i++) {
        const rateLimited = limiter.isRateLimited(
          `whatsapp:+1555000${i}`,
          `CH0123456789012345678901234567890${i}`
        )
        assert.strictEqual(rateLimited, false, `Request ${i + 1} should be allowed`)
      }
    })

    it('should block requests exceeding the global limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 5 },
        perPhone: { windowMs: 60000, maxMessages: 10, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 10 },
      })

      // First 5 requests should succeed (different phones to avoid per-phone limit)
      for (let i = 0; i < 5; i++) {
        const rateLimited = limiter.isRateLimited(
          `whatsapp:+1555000${i}`,
          `CH0123456789012345678901234567890${i}`
        )
        assert.strictEqual(rateLimited, false, `Request ${i + 1} should be allowed`)
      }

      // 6th request should be blocked
      const rateLimited = limiter.isRateLimited(
        'whatsapp:+15550006',
        'CH01234567890123456789012345678906'
      )
      assert.strictEqual(rateLimited, true, '6th request should be globally rate limited')
    })
  })

  describe('Per-phone rate limiting', () => {
    it('should allow requests under per-phone limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 3, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 10 },
      })

      const phone = 'whatsapp:+15551234567'
      for (let i = 0; i < 3; i++) {
        const rateLimited = limiter.isRateLimited(
          phone,
          `CH0123456789012345678901234567890${i}`
        )
        assert.strictEqual(rateLimited, false, `Request ${i + 1} should be allowed`)
      }
    })

    it('should block requests exceeding per-phone limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 2, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 10 },
      })

      const phone = 'whatsapp:+15551234567'
      // First 2 requests should succeed (different conversations)
      const rateLimited1 = limiter.isRateLimited(phone, 'CH01234567890123456789012345678901')
      const rateLimited2 = limiter.isRateLimited(phone, 'CH01234567890123456789012345678902')
      assert.strictEqual(rateLimited1, false, 'First request should be allowed')
      assert.strictEqual(rateLimited2, false, 'Second request should be allowed')

      // 3rd request should be blocked
      const rateLimited3 = limiter.isRateLimited(phone, 'CH01234567890123456789012345678903')
      assert.strictEqual(rateLimited3, true, 'Third request should be phone rate limited')
    })

    it('should track different phone numbers separately', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 2, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 10 },
      })

      // Max out first phone
      limiter.isRateLimited('whatsapp:+15551111111', 'CH01234567890123456789012345678901')
      limiter.isRateLimited('whatsapp:+15551111111', 'CH01234567890123456789012345678902')
      const blockedResult = limiter.isRateLimited(
        'whatsapp:+15551111111',
        'CH01234567890123456789012345678903'
      )
      assert.strictEqual(blockedResult, true, 'First phone should be rate limited')

      // Second phone should still be allowed
      const allowedResult = limiter.isRateLimited(
        'whatsapp:+15552222222',
        'CH01234567890123456789012345678904'
      )
      assert.strictEqual(allowedResult, false, 'Second phone should be allowed')
    })
  })

  describe('Per-conversation rate limiting', () => {
    it('should allow requests under per-conversation limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 100, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 3 },
      })

      const conversationSid = 'CH01234567890123456789012345678901'
      for (let i = 0; i < 3; i++) {
        const rateLimited = limiter.isRateLimited(
          `whatsapp:+1555123456${i}`, // Different phones to avoid per-phone limit
          conversationSid
        )
        assert.strictEqual(rateLimited, false, `Request ${i + 1} should be allowed`)
      }
    })

    it('should block requests exceeding per-conversation limit', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 100, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 2 },
      })

      const conversationSid = 'CH01234567890123456789012345678901'
      // First 2 requests should succeed (different phones)
      const rateLimited1 = limiter.isRateLimited('whatsapp:+15551234561', conversationSid)
      const rateLimited2 = limiter.isRateLimited('whatsapp:+15551234562', conversationSid)
      assert.strictEqual(rateLimited1, false, 'First request should be allowed')
      assert.strictEqual(rateLimited2, false, 'Second request should be allowed')

      // 3rd request should be blocked
      const rateLimited3 = limiter.isRateLimited('whatsapp:+15551234563', conversationSid)
      assert.strictEqual(rateLimited3, true, 'Third request should be conversation rate limited')
    })

    it('should track different conversations separately', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 100 },
        perPhone: { windowMs: 60000, maxMessages: 100, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 2 },
      })

      const phone = 'whatsapp:+15551234567'
      // Max out first conversation (need different phones due to phone limit)
      limiter.isRateLimited('whatsapp:+15551234561', 'CH01234567890123456789012345678901')
      limiter.isRateLimited('whatsapp:+15551234562', 'CH01234567890123456789012345678901')
      const blockedResult = limiter.isRateLimited(
        'whatsapp:+15551234563',
        'CH01234567890123456789012345678901'
      )
      assert.strictEqual(blockedResult, true, 'First conversation should be rate limited')

      // Second conversation should still be allowed
      const allowedResult = limiter.isRateLimited(phone, 'CH01234567890123456789012345678902')
      assert.strictEqual(allowedResult, false, 'Second conversation should be allowed')
    })
  })

  describe('Rate limiter stats and reset', () => {
    it('should track stats correctly', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 10 },
        perPhone: { windowMs: 60000, maxMessages: 5, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 5 },
      })

      // Make some requests
      limiter.isRateLimited('whatsapp:+15551111111', 'CH01234567890123456789012345678901')
      limiter.isRateLimited('whatsapp:+15552222222', 'CH01234567890123456789012345678902')

      const stats = limiter.getStats()
      assert.strictEqual(stats.globalTokens, 8, 'Should have 8 global tokens remaining')
      assert.strictEqual(stats.phoneCount, 2, 'Should track 2 phone numbers')
      assert.strictEqual(stats.conversationCount, 2, 'Should track 2 conversations')
    })

    it('should reset all state', () => {
      const limiter = new RateLimiter({
        global: { windowMs: 60000, maxMessages: 2 },
        perPhone: { windowMs: 60000, maxMessages: 2, blockDurationMs: 60000 },
        perConversation: { windowMs: 60000, maxMessages: 2 },
      })

      // Exhaust global limit
      limiter.isRateLimited('whatsapp:+15551111111', 'CH01234567890123456789012345678901')
      limiter.isRateLimited('whatsapp:+15552222222', 'CH01234567890123456789012345678902')

      // Should be rate limited
      const rateLimited = limiter.isRateLimited(
        'whatsapp:+15553333333',
        'CH01234567890123456789012345678903'
      )
      assert.strictEqual(rateLimited, true, 'Should be rate limited before reset')

      // Reset and try again
      limiter.reset()
      const notRateLimited = limiter.isRateLimited(
        'whatsapp:+15553333333',
        'CH01234567890123456789012345678903'
      )
      assert.strictEqual(notRateLimited, false, 'Should NOT be rate limited after reset')
    })
  })
})
