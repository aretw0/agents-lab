import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
	readColonyRetentionSnapshot,
	type ColonyRetentionSnapshot,
} from "./colony-pilot-candidate-retention";
import { buildAntColonyMirrorCandidates } from "./colony-pilot-runtime";

export interface ColonyPilotArtifactsColonyEntry {
	id: string;
	status: string;
	updatedAt: number;
	goal?: string;
	statePath: string;
}

export interface ColonyPilotArtifactsWorktreeEntry {
	name: string;
	path: string;
	updatedAt: number;
}

export interface ColonyPilotArtifactsMirror {
	root: string;
	colonies: ColonyPilotArtifactsColonyEntry[];
	worktrees: ColonyPilotArtifactsWorktreeEntry[];
}

export interface ColonyPilotArtifactsSnapshot {
	cwd: string;
	mirrors: ColonyPilotArtifactsMirror[];
	retention: ColonyRetentionSnapshot;
}

export function inspectAntColonyRuntime(
	cwd: string,
): ColonyPilotArtifactsSnapshot {
	const roots = buildAntColonyMirrorCandidates(cwd).filter((p) =>
		existsSync(p),
	);
	const retention = readColonyRetentionSnapshot(cwd, 12);

	const mirrors = roots.map((rootPath) => {
		const coloniesDir = path.join(rootPath, "colonies");
		const worktreesDir = path.join(rootPath, "worktrees");

		const colonies: ColonyPilotArtifactsColonyEntry[] = [];
		if (existsSync(coloniesDir)) {
			for (const d of readdirSync(coloniesDir, { withFileTypes: true })) {
				if (!d.isDirectory()) continue;
				const statePath = path.join(coloniesDir, d.name, "state.json");
				if (!existsSync(statePath)) continue;
				try {
					const json = JSON.parse(readFileSync(statePath, "utf8"));
					const st = statSync(statePath);
					colonies.push({
						id: json.id ?? d.name,
						status: json.status ?? "unknown",
						goal: typeof json.goal === "string" ? json.goal : undefined,
						updatedAt: st.mtimeMs,
						statePath,
					});
				} catch {
					// ignore malformed state
				}
			}
		}

		colonies.sort((a, b) => b.updatedAt - a.updatedAt);

		const worktrees: ColonyPilotArtifactsWorktreeEntry[] = [];
		if (existsSync(worktreesDir)) {
			for (const d of readdirSync(worktreesDir, { withFileTypes: true })) {
				if (!d.isDirectory()) continue;
				const full = path.join(worktreesDir, d.name);
				if (!existsSync(path.join(full, ".git"))) continue;
				worktrees.push({
					name: d.name,
					path: full,
					updatedAt: statSync(full).mtimeMs,
				});
			}
		}

		worktrees.sort((a, b) => b.updatedAt - a.updatedAt);

		return {
			root: rootPath,
			colonies: colonies.slice(0, 8),
			worktrees: worktrees.slice(0, 8),
		};
	});

	return { cwd: path.resolve(cwd), mirrors, retention };
}

export function formatArtifactsReport(data: ColonyPilotArtifactsSnapshot): string {
	const out: string[] = [];
	out.push("colony-pilot artifacts");
	out.push(`cwd: ${data.cwd}`);

	if (data.mirrors.length === 0) {
		out.push("No ant-colony workspace mirror found for this cwd.");
	}

	for (const m of data.mirrors) {
		out.push("");
		out.push(`mirror: ${m.root}`);

		out.push("  colonies:");
		if (m.colonies.length === 0) out.push("    (none)");
		for (const c of m.colonies) {
			out.push(
				`    - ${c.id} [${c.status}] ${new Date(c.updatedAt).toISOString()}`,
			);
			out.push(`      state: ${c.statePath}`);
			if (c.goal) out.push(`      goal: ${c.goal.slice(0, 100)}`);
		}

		out.push("  worktrees:");
		if (m.worktrees.length === 0) out.push("    (none)");
		for (const w of m.worktrees) {
			out.push(`    - ${w.name} ${new Date(w.updatedAt).toISOString()}`);
			out.push(`      path: ${w.path}`);
		}
	}

	out.push("");
	out.push(`retention: ${data.retention.exists ? "enabled" : "absent"}`);
	out.push(`retentionRoot: ${data.retention.root}`);
	out.push(`retentionRecords: ${data.retention.count}`);
	if (data.retention.records.length === 0) {
		out.push("  (none)");
	} else {
		for (const entry of data.retention.records) {
			out.push(
				`  - ${entry.record.colonyId} [${entry.record.phase}] ${entry.updatedAtIso}`,
			);
			out.push(`    file: ${entry.path}`);
			if (entry.record.runtimeColonyId) {
				out.push(`    runtimeId: ${entry.record.runtimeColonyId}`);
			}
			if (entry.record.runtimeSnapshotPath) {
				out.push(`    recovery: ${entry.record.runtimeSnapshotPath}`);
			}
			if (entry.record.runtimeSnapshotMissingReason) {
				out.push(
					`    recovery-missing: ${entry.record.runtimeSnapshotMissingReason}`,
				);
			}
			if (entry.record.goal) {
				out.push(`    goal: ${entry.record.goal.slice(0, 100)}`);
			}
		}
	}

	return out.join("\n");
}
