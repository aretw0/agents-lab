import { isProviderRequestTimeoutError } from "./context-watchdog-runtime-helpers";

export const CONTEXT_WATCHDOG_RUNTIME_CONSTANTS = {
	SIGNAL_NOISE_WINDOW_MS: 10 * 60 * 1000,
	SIGNAL_NOISE_MAX_ANNOUNCEMENTS: 4,
	FINAL_TURN_CLOSE_HEADROOM_PCT: 10,
	CALM_CLOSE_DEFER_THRESHOLD: 3,
	ANTI_PARALYSIS_GRACE_WINDOW_MS: 2 * 60 * 1000,
	ANTI_PARALYSIS_NOTIFY_COOLDOWN_MS: 5 * 60 * 1000,
	ANTI_PARALYSIS_MAX_NOTIFIES_PER_WINDOW: 1,
	TIMEOUT_PRESSURE_WINDOW_MS: 10 * 60 * 1000,
	TIMEOUT_PRESSURE_THRESHOLD: 2,
	POST_RELOAD_PENDING_NOTIFY_MIN_COOLDOWN_MS: 5 * 60 * 1000,
} as const;

export interface ContextWatchTimeoutPressureState {
	active: boolean;
	count: number;
	threshold: number;
	windowMs: number;
	windowStartedAtMs: number;
	lastSeenAtMs: number;
	ageMs?: number;
	lastMessage: string;
}

export interface ContextWatchTimeoutPressureEvent {
	matched: boolean;
	state: ContextWatchTimeoutPressureState;
}

export function createContextWatchAnnouncementWindow(
	windowMs = CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.SIGNAL_NOISE_WINDOW_MS,
) {
	let windowStartedAt = 0;
	let announcementCount = 0;
	let finalTurnSuppressionCount = 0;

	const isWindowActive = (nowMs: number): boolean => {
		return windowStartedAt > 0 && (nowMs - windowStartedAt) <= windowMs;
	};

	const ensureWindow = (nowMs: number): void => {
		if (isWindowActive(nowMs)) return;
		windowStartedAt = nowMs;
		announcementCount = 0;
		finalTurnSuppressionCount = 0;
	};

	return {
		getAnnouncementsInWindow(nowMs: number): number {
			return isWindowActive(nowMs) ? announcementCount : 0;
		},
		markAnnouncement(nowMs: number): void {
			ensureWindow(nowMs);
			announcementCount += 1;
		},
		markFinalTurnSuppression(nowMs: number): void {
			ensureWindow(nowMs);
			finalTurnSuppressionCount += 1;
		},
		getFinalTurnSuppressionsInWindow(nowMs: number): number {
			return isWindowActive(nowMs) ? finalTurnSuppressionCount : 0;
		},
		reset(): void {
			windowStartedAt = 0;
			announcementCount = 0;
			finalTurnSuppressionCount = 0;
		},
	};
}

export function createContextWatchTimeoutPressure(
	options: {
		windowMs?: number;
		threshold?: number;
		isTimeoutError?: (message: string) => boolean;
	} = {},
) {
	const windowMs = options.windowMs ?? CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.TIMEOUT_PRESSURE_WINDOW_MS;
	const threshold = options.threshold ?? CONTEXT_WATCHDOG_RUNTIME_CONSTANTS.TIMEOUT_PRESSURE_THRESHOLD;
	const isTimeoutError = options.isTimeoutError ?? isProviderRequestTimeoutError;
	let windowStartedAt = 0;
	let count = 0;
	let lastSeenAt = 0;
	let lastMessage = "";

	const decayWindow = (nowMs: number): void => {
		if (windowStartedAt <= 0) return;
		if ((nowMs - windowStartedAt) <= windowMs) return;
		windowStartedAt = 0;
		count = 0;
	};

	const readTimeoutPressureState = (nowMs: number): ContextWatchTimeoutPressureState => {
		decayWindow(nowMs);
		const ageMs = lastSeenAt > 0 ? Math.max(0, nowMs - lastSeenAt) : undefined;
		return {
			active: count >= threshold,
			count,
			threshold,
			windowMs,
			windowStartedAtMs: windowStartedAt,
			lastSeenAtMs: lastSeenAt,
			ageMs,
			lastMessage,
		};
	};

	return {
		readTimeoutPressureState,
		recordTimeoutPressure(message: string, nowMs: number): ContextWatchTimeoutPressureEvent {
			if (!isTimeoutError(message)) {
				return { matched: false, state: readTimeoutPressureState(nowMs) };
			}
			if (windowStartedAt <= 0 || (nowMs - windowStartedAt) > windowMs) {
				windowStartedAt = nowMs;
				count = 0;
			}
			count += 1;
			lastSeenAt = nowMs;
			lastMessage = String(message ?? "").slice(0, 240);
			return { matched: true, state: readTimeoutPressureState(nowMs) };
		},
		reset(): void {
			windowStartedAt = 0;
			count = 0;
			lastSeenAt = 0;
			lastMessage = "";
		},
	};
}
