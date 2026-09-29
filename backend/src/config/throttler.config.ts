import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';

/**
 * Global rate limiting.
 *
 * IMPORTANT: @nestjs/throttler applies *every* entry in `throttlers` to *every*
 * route. Adding a stricter named throttler here therefore lowers the limit for
 * the whole API, not just the routes it was meant for — declaring a 5/min
 * "auth" throttler alongside this one caps the entire app at 5 req/min.
 *
 * So keep exactly one entry here, and tighten individual routes with
 * `@Throttle({ default: { limit, ttl } })` on the controller instead
 * (see `AuthController`). Per-area limits that need config values should be
 * applied the same way, or read at request time rather than in the decorator.
 */
export const getThrottlerConfig = (
  configService: ConfigService,
): ThrottlerModuleOptions => {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: 60000, // 1 minute
        limit: parseInt(configService.get<string>('RATE_LIMIT', '100'), 10),
      },
    ],
  };
};
