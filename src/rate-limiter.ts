/**
 * Rate Limiter - Token bucket implementation for WhatsApp webhook protection
 *
 * Implements multi-level rate limiting to prevent DoS attacks:
 * - Per-phone number (prevents individual abuse)
 * - Per-conversation (prevents conversation flooding)
 * - Global (prevents system-wide overload)
 *
 * SECURITY: Critical defense layer against webhook flooding attacks
 */

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  // Per-phone number limits
  perPhone: {
    windowMs: number;        // Time window
    maxMessages: number;     // Max messages in window
    blockDurationMs: number; // Block duration after violation
  };

  // Per-conversation limits
  perConversation: {
    windowMs: number;
    maxMessages: number;
  };

  // Global limits (all sources)
  global: {
    windowMs: number;
    maxMessages: number;
  };
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  perPhone: {
    windowMs: 60000,        // 1 minute
    maxMessages: 10,        // 10 messages per minute per phone
    blockDurationMs: 300000 // 5 minute block
  },
  perConversation: {
    windowMs: 60000,        // 1 minute
    maxMessages: 20         // 20 messages per minute per conversation
  },
  global: {
    windowMs: 60000,        // 1 minute
    maxMessages: 100        // 100 total messages per minute
  }
};

/**
 * Token bucket implementation
 *
 * Uses token bucket algorithm for smooth rate limiting:
 * - Tokens refill at a constant rate
 * - Each request consumes a token
 * - Requests fail when bucket is empty
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillIntervalMs: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume tokens
   * Returns true if successful, false if rate limited
   */
  tryConsume(count: number): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;

    if (timePassed >= this.refillIntervalMs) {
      this.tokens = this.capacity;
      this.lastRefill = now;
    }
  }

  /**
   * Get current token count (for monitoring/debugging)
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Multi-level rate limiter
 *
 * Checks rate limits at three levels in order:
 * 1. Global (cheapest check, protects entire system)
 * 2. Per-phone (prevents abuse from single phone number)
 * 3. Per-conversation (prevents conversation flooding)
 */
export class RateLimiter {
  private phoneBuckets = new Map<string, TokenBucket>();
  private conversationBuckets = new Map<string, TokenBucket>();
  private phoneTimeouts = new Map<string, NodeJS.Timeout>();
  private conversationTimeouts = new Map<string, NodeJS.Timeout>();
  private globalBucket: TokenBucket;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG) {
    this.config = config;
    this.globalBucket = new TokenBucket(
      config.global.maxMessages,
      config.global.windowMs
    );
  }

  /**
   * Check if request should be rate limited
   * Returns true if rate limited (reject request)
   *
   * SECURITY: Checks limits in order of cost (global first, cheapest)
   *
   * @param phoneNumber Phone number (e.g., "whatsapp:+14155551234")
   * @param conversationSid Twilio Conversations SID
   */
  isRateLimited(phoneNumber: string, conversationSid: string): boolean {
    // Check global limit first (cheapest check)
    if (!this.globalBucket.tryConsume(1)) {
      return true; // Rate limited globally
    }

    // Check per-phone limit
    const phoneBucket = this.getOrCreatePhoneBucket(phoneNumber);
    if (!phoneBucket.tryConsume(1)) {
      return true; // Rate limited for this phone
    }

    // Check per-conversation limit
    const convBucket = this.getOrCreateConversationBucket(conversationSid);
    if (!convBucket.tryConsume(1)) {
      return true; // Rate limited for this conversation
    }

    return false; // Not rate limited
  }

  /**
   * Get or create phone bucket with auto-cleanup
   */
  private getOrCreatePhoneBucket(phoneNumber: string): TokenBucket {
    let bucket = this.phoneBuckets.get(phoneNumber);
    if (!bucket) {
      bucket = new TokenBucket(
        this.config.perPhone.maxMessages,
        this.config.perPhone.windowMs
      );
      this.phoneBuckets.set(phoneNumber, bucket);

      // Clean up after block duration to prevent memory leak
      const timeout = setTimeout(() => {
        this.phoneBuckets.delete(phoneNumber);
        this.phoneTimeouts.delete(phoneNumber);
      }, this.config.perPhone.blockDurationMs);
      timeout.unref(); // Don't block process exit
      this.phoneTimeouts.set(phoneNumber, timeout);
    }
    return bucket;
  }

  /**
   * Get or create conversation bucket (no auto-cleanup, sessions are short-lived)
   */
  private getOrCreateConversationBucket(conversationSid: string): TokenBucket {
    let bucket = this.conversationBuckets.get(conversationSid);
    if (!bucket) {
      bucket = new TokenBucket(
        this.config.perConversation.maxMessages,
        this.config.perConversation.windowMs
      );
      this.conversationBuckets.set(conversationSid, bucket);

      // Cleanup after inactivity timeout (7 minutes default) to prevent memory leak
      const timeout = setTimeout(() => {
        this.conversationBuckets.delete(conversationSid);
        this.conversationTimeouts.delete(conversationSid);
      }, 7 * 60 * 1000); // 7 minutes - typical session inactivity timeout
      timeout.unref(); // Don't block process exit
      this.conversationTimeouts.set(conversationSid, timeout);
    }
    return bucket;
  }

  /**
   * Get current rate limit stats (for monitoring)
   */
  getStats(): {
    globalTokens: number;
    phoneCount: number;
    conversationCount: number;
  } {
    return {
      globalTokens: this.globalBucket.getTokens(),
      phoneCount: this.phoneBuckets.size,
      conversationCount: this.conversationBuckets.size,
    };
  }

  /**
   * Clear all rate limit state (for testing)
   */
  reset(): void {
    // Clear all phone timeouts to prevent memory leaks
    for (const timeout of this.phoneTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.phoneTimeouts.clear();

    // Clear all conversation timeouts to prevent memory leaks
    for (const timeout of this.conversationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.conversationTimeouts.clear();

    this.phoneBuckets.clear();
    this.conversationBuckets.clear();
    this.globalBucket = new TokenBucket(
      this.config.global.maxMessages,
      this.config.global.windowMs
    );
  }
}
