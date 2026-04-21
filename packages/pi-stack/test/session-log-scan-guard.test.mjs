/**
 * Tests for session-log scan blocker (guardrails-core).
 *
 * Run: node --test packages/pi-stack/test/session-log-scan-guard.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const SESSION_LOG_PATH_PATTERN = /(^|[^\w.-])\.pi\/agent\/sessions(\/|$)/i;
const SESSION_LOG_CONTENT_SCAN_PATTERN =
	/\b(?:grep|rg|findstr|awk|sed|cat|tail|head|more|less)\b/i;
const SESSION_LOG_FILENAME_ONLY_PATTERN =
	/\b(?:grep|rg)\b[\s\S]*\b(?:--files-with-matches|--files-without-match)\b|\b(?:grep|rg)\b[\s\S]*\s-[a-z]*l[a-z]*\b/i;
const SESSION_LOG_COUNT_ONLY_PATTERN =
	/\|\s*wc\s+-l\b|\b(?:grep|rg)\b[\s\S]*\b--count\b|\b(?:grep|rg)\b[\s\S]*\s-[a-z]*c[a-z]*\b/i;
const PI_ROOT_PATH_PATTERN =
	/(^|\s)(?:\.\/)?\.pi(?=\s|$|[|;&])|(^|\s)~\/\.pi(?=\s|$|[|;&])|(^|\s)[a-z]:\/users\/[^/\s]+\/\.pi(?=\s|$|[|;&])|(^|\s)\/mnt\/[a-z]\/users\/[^/\s]+\/\.pi(?=\s|$|[|;&])/i;
const PI_ROOT_RECURSIVE_SCAN_TOOL_PATTERN =
	/\brg\b|\bgrep\b[\s\S]*\b--recursive\b|\bgrep\b[\s\S]*\s-[a-z]*r[a-z]*\b|\bfindstr\b[\s\S]*\s\/s\b/i;

function detectHighRiskSessionLogScan(command) {
	const normalized = command.toLowerCase().replace(/\\/g, "/");
	if (!SESSION_LOG_PATH_PATTERN.test(normalized)) return false;
	if (!SESSION_LOG_CONTENT_SCAN_PATTERN.test(normalized)) return false;
	if (SESSION_LOG_FILENAME_ONLY_PATTERN.test(normalized)) return false;
	if (SESSION_LOG_COUNT_ONLY_PATTERN.test(normalized)) return false;
	return true;
}

function detectHighRiskPiRootRecursiveScan(command) {
	const normalized = command.toLowerCase().replace(/\\/g, "/");
	if (!PI_ROOT_PATH_PATTERN.test(normalized)) return false;
	if (!PI_ROOT_RECURSIVE_SCAN_TOOL_PATTERN.test(normalized)) return false;
	if (SESSION_LOG_FILENAME_ONLY_PATTERN.test(normalized)) return false;
	if (SESSION_LOG_COUNT_ONLY_PATTERN.test(normalized)) return false;
	return true;
}

describe("detectHighRiskSessionLogScan", () => {
	it("blocks grep over session logs", () => {
		const cmd =
			'grep -RIn "Maximum call stack size exceeded" ~/.pi/agent/sessions';
		assert.equal(detectHighRiskSessionLogScan(cmd), true);
	});

	it("blocks rg over session logs", () => {
		const cmd =
			'rg -n "wrapTextWithAnsi" /mnt/c/Users/aretw/.pi/agent/sessions';
		assert.equal(detectHighRiskSessionLogScan(cmd), true);
	});

	it("blocks direct content reads over session logs", () => {
		const cmd =
			"cat C:/Users/aretw/.pi/agent/sessions/--C--Users-aretw--/x.jsonl";
		assert.equal(detectHighRiskSessionLogScan(cmd), true);
	});

	it("allows filename-only scans", () => {
		const cmd =
			'grep -RIl "Maximum call stack size exceeded" ~/.pi/agent/sessions';
		assert.equal(detectHighRiskSessionLogScan(cmd), false);
	});

	it("allows count-only scans", () => {
		const cmd =
			'grep -RIn "Maximum call stack size exceeded" ~/.pi/agent/sessions | wc -l';
		assert.equal(detectHighRiskSessionLogScan(cmd), false);
	});

	it("allows non-content operations in session logs", () => {
		const cmd = "ls -la ~/.pi/agent/sessions";
		assert.equal(detectHighRiskSessionLogScan(cmd), false);
	});

	it("does not block grep outside session logs", () => {
		const cmd = 'grep -RIn "TODO" ./packages';
		assert.equal(detectHighRiskSessionLogScan(cmd), false);
	});
});

describe("detectHighRiskPiRootRecursiveScan", () => {
	it("blocks recursive grep on project .pi root", () => {
		const cmd = 'grep -RIn "wrapTextWithAnsi" .pi';
		assert.equal(detectHighRiskPiRootRecursiveScan(cmd), true);
	});

	it("blocks recursive rg on user .pi root", () => {
		const cmd = 'rg -n "Maximum call stack size exceeded" ~/.pi';
		assert.equal(detectHighRiskPiRootRecursiveScan(cmd), true);
	});

	it("allows filename-only recursive scan on .pi root", () => {
		const cmd = 'grep -RIl "wrapTextWithAnsi" .pi';
		assert.equal(detectHighRiskPiRootRecursiveScan(cmd), false);
	});

	it("allows count-only recursive scan on .pi root", () => {
		const cmd = 'grep -RIn "wrapTextWithAnsi" .pi | wc -l';
		assert.equal(detectHighRiskPiRootRecursiveScan(cmd), false);
	});

	it("does not block non-recursive single-file grep under .pi", () => {
		const cmd = 'grep "quotaPanel" .pi/settings.json';
		assert.equal(detectHighRiskPiRootRecursiveScan(cmd), false);
	});
});
