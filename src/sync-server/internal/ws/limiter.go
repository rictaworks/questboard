package ws

import (
	"sync"
	"time"
)

type TokenBucket struct {
	mu           sync.Mutex
	rate         float64   // tokens per second
	capacity     float64   // max burst size
	tokens       float64
	lastRefilled time.Time
}

func NewTokenBucket(rate, capacity float64) *TokenBucket {
	return &TokenBucket{
		rate:         rate,
		capacity:     capacity,
		tokens:       capacity,
		lastRefilled: time.Now(),
	}
}

func (tb *TokenBucket) Allow(tokens float64) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(tb.lastRefilled).Seconds()
	tb.lastRefilled = now

	tb.tokens += elapsed * tb.rate
	if tb.tokens > tb.capacity {
		tb.tokens = tb.capacity
	}

	if tb.tokens >= tokens {
		tb.tokens -= tokens
		return true
	}
	return false
}

type UserBoardLimiter struct {
	eventsBucket *TokenBucket
	bytesBucket  *TokenBucket
	lastAccess   time.Time
}

type RateLimiter struct {
	mu          sync.Mutex
	limiters    map[string]*UserBoardLimiter
	lastCleaned time.Time
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		limiters:    make(map[string]*UserBoardLimiter),
		lastCleaned: time.Now(),
	}
}

func (rl *RateLimiter) Allow(boardID, userID string, eventSize int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	// Clean up inactive limiters every 1 minute
	if now.Sub(rl.lastCleaned) > 1*time.Minute {
		for key, lim := range rl.limiters {
			// Remove entries inactive for more than 5 minutes
			if now.Sub(lim.lastAccess) > 5*time.Minute {
				delete(rl.limiters, key)
			}
		}
		rl.lastCleaned = now
	}

	key := boardID + ":" + userID
	limiter, exists := rl.limiters[key]
	if !exists {
		// Event bucket: average 40 events/sec, burst up to 60 events.
		// Byte bucket: average 10 KB/sec (10240 bytes), burst up to 20 KB (20480 bytes).
		// This easily accommodates normal 30Hz cursor updates (approx 80 bytes * 30 = 2.4 KB/sec),
		// while strictly blocking larger bursts or high-frequency updates.
		limiter = &UserBoardLimiter{
			eventsBucket: NewTokenBucket(40, 60),
			bytesBucket:  NewTokenBucket(10240, 20480),
		}
		rl.limiters[key] = limiter
	}
	limiter.lastAccess = now

	if !limiter.eventsBucket.Allow(1) {
		return false
	}
	if !limiter.bytesBucket.Allow(float64(eventSize)) {
		return false
	}
	return true
}
