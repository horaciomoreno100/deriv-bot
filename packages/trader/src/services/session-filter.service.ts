/**
 * Session Filter Service
 *
 * Filters trades based on trading session (Asian, London, NY, etc.)
 * Provides session-specific parameters for stake sizing and SL adjustment.
 *
 * Based on analysis showing different MR performance by session:
 * - Asian: Low volatility, good for MR
 * - London: High volatility, moderate for MR
 * - Overlap: Highest volatility, reduced stake recommended
 * - NY: Moderate volatility, good for MR
 * - Closed: No trading
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Trading session identifier
 */
export type TradingSession = 'ASIAN' | 'LONDON' | 'OVERLAP' | 'NY' | 'CLOSED';

/**
 * Session-specific trading parameters
 */
export interface SessionParams {
  /** Session name */
  session: TradingSession;
  /** Stake percentage multiplier (1.0 = 100%) */
  stakePct: number;
  /** Stop loss multiplier adjustment */
  slMultiplier: number;
  /** Whether extra filter is required (e.g., BB width check) */
  requiresExtraFilter: boolean;
  /** Description of extra filter if required */
  extraFilterDescription?: string;
}

/**
 * Session time definition (UTC hours)
 */
interface SessionTimeRange {
  session: TradingSession;
  startHour: number;
  endHour: number;
}

/**
 * Session filter configuration
 */
export interface SessionFilterConfig {
  /** Enable filtering (default: true) */
  enabled: boolean;
  /** Sessions to allow trading in */
  allowedSessions: TradingSession[];
  /** Use custom session times */
  customSessionTimes?: SessionTimeRange[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default session time ranges (UTC)
 *
 * Forex Market Sessions:
 * - Sydney:    22:00 - 07:00 UTC (we merge with Asian)
 * - Tokyo:     00:00 - 09:00 UTC
 * - London:    07:00 - 16:00 UTC
 * - New York:  13:00 - 22:00 UTC
 *
 * Simplified for MR trading:
 * - ASIAN:   00:00 - 07:00 UTC (Tokyo + Sydney quiet hours)
 * - LONDON:  07:00 - 13:00 UTC (London only)
 * - OVERLAP: 13:00 - 16:00 UTC (London + NY overlap - highest volatility)
 * - NY:      16:00 - 22:00 UTC (NY only)
 * - CLOSED:  22:00 - 00:00 UTC (low liquidity gap)
 */
const DEFAULT_SESSION_TIMES: SessionTimeRange[] = [
  { session: 'ASIAN', startHour: 0, endHour: 7 },
  { session: 'LONDON', startHour: 7, endHour: 13 },
  { session: 'OVERLAP', startHour: 13, endHour: 16 },
  { session: 'NY', startHour: 16, endHour: 22 },
  { session: 'CLOSED', startHour: 22, endHour: 24 },
];

/**
 * Default session parameters
 * Based on MR strategy analysis
 */
const DEFAULT_SESSION_PARAMS: Record<TradingSession, SessionParams> = {
  ASIAN: {
    session: 'ASIAN',
    stakePct: 1.0, // 100% stake
    slMultiplier: 1.5, // Tighter SL (low volatility)
    requiresExtraFilter: false,
  },
  LONDON: {
    session: 'LONDON',
    stakePct: 1.0, // 100% stake
    slMultiplier: 2.0, // Wider SL (higher volatility)
    requiresExtraFilter: false,
  },
  OVERLAP: {
    session: 'OVERLAP',
    stakePct: 0.5, // 50% stake (highest risk period)
    slMultiplier: 2.0, // Wider SL
    requiresExtraFilter: true, // Require BB width < average
    extraFilterDescription: 'BB Width must be below average for entry',
  },
  NY: {
    session: 'NY',
    stakePct: 0.75, // 75% stake
    slMultiplier: 1.5, // Normal SL
    requiresExtraFilter: false,
  },
  CLOSED: {
    session: 'CLOSED',
    stakePct: 0, // No trading
    slMultiplier: 0,
    requiresExtraFilter: false,
  },
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SessionFilterConfig = {
  enabled: true,
  allowedSessions: ['ASIAN', 'LONDON', 'OVERLAP', 'NY'],
};

// ============================================================================
// SESSION FILTER SERVICE
// ============================================================================

/**
 * Session Filter Service
 *
 * Provides session-based filtering and parameter adjustment for trading strategies.
 *
 * Usage:
 * ```typescript
 * const sessionFilter = new SessionFilterService();
 *
 * // Check if trading is allowed
 * if (sessionFilter.shouldTrade(timestamp)) {
 *   // Get session-specific parameters
 *   const params = sessionFilter.getSessionParams(timestamp);
 *   adjustedStake = baseStake * params.stakePct;
 *   adjustedSL = baseSL * params.slMultiplier;
 * }
 * ```
 */
export class SessionFilterService {
  private config: SessionFilterConfig;
  private sessionTimes: SessionTimeRange[];
  private sessionParams: Record<TradingSession, SessionParams>;

  constructor(
    config: Partial<SessionFilterConfig> = {},
    customParams?: Partial<Record<TradingSession, Partial<SessionParams>>>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionTimes = config.customSessionTimes || DEFAULT_SESSION_TIMES;

    // Merge custom params with defaults
    this.sessionParams = { ...DEFAULT_SESSION_PARAMS };
    if (customParams) {
      for (const [session, params] of Object.entries(customParams)) {
        this.sessionParams[session as TradingSession] = {
          ...this.sessionParams[session as TradingSession],
          ...params,
        };
      }
    }
  }

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Get current session for a timestamp
   * @param timestamp - Unix timestamp in milliseconds or seconds
   */
  getSession(timestamp: number): TradingSession {
    // Convert seconds to milliseconds if needed
    const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const date = new Date(ts);
    const hourUTC = date.getUTCHours();

    for (const range of this.sessionTimes) {
      if (range.startHour <= hourUTC && hourUTC < range.endHour) {
        return range.session;
      }
    }

    // Handle wrap-around (22:00 - 00:00)
    if (hourUTC >= 22 || hourUTC < 0) {
      return 'CLOSED';
    }

    return 'CLOSED';
  }

  /**
   * Get session parameters for a timestamp
   * @param timestamp - Unix timestamp in milliseconds or seconds
   */
  getSessionParams(timestamp: number): SessionParams {
    const session = this.getSession(timestamp);
    return { ...this.sessionParams[session] };
  }

  /**
   * Check if trading should be allowed at this time
   * @param timestamp - Unix timestamp in milliseconds or seconds
   */
  shouldTrade(timestamp: number): boolean {
    if (!this.config.enabled) {
      return true; // Filter disabled, allow all
    }

    const session = this.getSession(timestamp);
    return this.config.allowedSessions.includes(session);
  }

  /**
   * Get detailed filter result
   * @param timestamp - Unix timestamp in milliseconds or seconds
   */
  shouldTradeDetailed(timestamp: number): {
    canTrade: boolean;
    session: TradingSession;
    params: SessionParams;
    reason?: string;
  } {
    const session = this.getSession(timestamp);
    const params = this.sessionParams[session];

    if (!this.config.enabled) {
      return { canTrade: true, session, params };
    }

    const canTrade = this.config.allowedSessions.includes(session);

    return {
      canTrade,
      session,
      params,
      reason: canTrade
        ? undefined
        : `Session ${session} is not in allowed sessions`,
    };
  }

  /**
   * Get session windows for a specific date
   * Returns array of session periods with start/end times
   */
  getSessionWindows(date: Date = new Date()): Array<{
    session: TradingSession;
    startTime: Date;
    endTime: Date;
    params: SessionParams;
  }> {
    const dateStr = date.toISOString().split('T')[0];

    return this.sessionTimes.map((range) => {
      const startTime = new Date(`${dateStr}T${String(range.startHour).padStart(2, '0')}:00:00Z`);
      let endTime = new Date(`${dateStr}T${String(range.endHour).padStart(2, '0')}:00:00Z`);

      // Handle end hour 24 (next day 00:00)
      if (range.endHour === 24) {
        endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
        endTime.setUTCHours(0, 0, 0, 0);
      }

      return {
        session: range.session,
        startTime,
        endTime,
        params: this.sessionParams[range.session],
      };
    });
  }

  /**
   * Get trading schedule summary for today
   */
  getTodaySchedule(): string {
    const windows = this.getSessionWindows();
    const lines: string[] = ['Trading Schedule (UTC):'];

    for (const window of windows) {
      const startHour = window.startTime.getUTCHours().toString().padStart(2, '0');
      const endHour = window.endTime.getUTCHours().toString().padStart(2, '0');
      const status = this.config.allowedSessions.includes(window.session)
        ? '✅'
        : '❌';
      const stake = window.params.stakePct > 0
        ? `${(window.params.stakePct * 100).toFixed(0)}%`
        : 'OFF';

      lines.push(
        `  ${status} ${window.session.padEnd(8)} ${startHour}:00-${endHour}:00 | Stake: ${stake} | SL: x${window.params.slMultiplier}`
      );
    }

    return lines.join('\n');
  }

  /**
   * Get minutes until next allowed session
   */
  getMinutesToNextSession(timestamp: number): {
    nextSession: TradingSession;
    minutesUntil: number;
  } | null {
    const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const currentSession = this.getSession(timestamp);

    // If current session is allowed, return null
    if (this.config.allowedSessions.includes(currentSession)) {
      return null;
    }

    const date = new Date(ts);
    const currentHour = date.getUTCHours();
    const currentMinute = date.getUTCMinutes();

    // Find next allowed session
    for (const range of this.sessionTimes) {
      if (
        this.config.allowedSessions.includes(range.session) &&
        range.startHour > currentHour
      ) {
        const minutesUntil =
          (range.startHour - currentHour) * 60 - currentMinute;
        return { nextSession: range.session, minutesUntil };
      }
    }

    // Wrap to next day (first allowed session)
    for (const range of this.sessionTimes) {
      if (this.config.allowedSessions.includes(range.session)) {
        const minutesUntil =
          (24 - currentHour + range.startHour) * 60 - currentMinute;
        return { nextSession: range.session, minutesUntil };
      }
    }

    return null;
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SessionFilterConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.customSessionTimes) {
      this.sessionTimes = config.customSessionTimes;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SessionFilterConfig {
    return { ...this.config };
  }

  /**
   * Enable/disable filtering
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if filtering is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ============================================================================
// FACTORY & SINGLETON
// ============================================================================

/**
 * Create a new session filter with custom configuration
 */
export function createSessionFilter(
  config?: Partial<SessionFilterConfig>,
  customParams?: Partial<Record<TradingSession, Partial<SessionParams>>>
): SessionFilterService {
  return new SessionFilterService(config, customParams);
}

/**
 * Singleton instance for easy access
 */
let defaultInstance: SessionFilterService | null = null;

export function getSessionFilter(): SessionFilterService {
  if (!defaultInstance) {
    defaultInstance = createSessionFilter();
  }
  return defaultInstance;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format session time for display
 */
export function formatSessionTime(timestamp: number): string {
  const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ts);
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date
    .getUTCMinutes()
    .toString()
    .padStart(2, '0')} UTC`;
}

/**
 * Check if timestamp is during high volatility period
 */
export function isHighVolatilityPeriod(timestamp: number): boolean {
  const sessionFilter = getSessionFilter();
  const session = sessionFilter.getSession(timestamp);
  return session === 'OVERLAP' || session === 'LONDON';
}

/**
 * Get recommended stake multiplier for current time
 */
export function getRecommendedStakeMultiplier(timestamp: number): number {
  const sessionFilter = getSessionFilter();
  const params = sessionFilter.getSessionParams(timestamp);
  return params.stakePct;
}
