import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
	return readFileSync(path, "utf8");
}

test("docs site uses the minimal Hacker Jekyll surface", () => {
	const config = read("docs/_config.yml");

	assert.match(config, /^remote_theme: pages-themes\/hacker@v0\.2\.0$/m);
	assert.match(config, /^\s+- jekyll-remote-theme$/m);
	assert.match(config, /^baseurl: \/agents-lab$/m);
	assert.match(config, /^repo_url: https:\/\/github\.com\/aretw0\/agents-lab$/m);
});

test("docs site excludes heavy or non-canonical material", () => {
	const config = read("docs/_config.yml");

	for (const excludedPath of ["archive", "research/data", "node_modules", "vendor", "_site"]) {
		assert.match(config, new RegExp(`^\\s+- ${excludedPath.replace("/", "\\/")}$`, "m"));
	}
});

test("docs homepage routes readers through canonical information architecture", () => {
	const index = read("docs/index.md");

	for (const link of [
		"./start-here.md",
		"{{ site.repo_url }}/blob/main/README.md",
		"{{ site.repo_url }}/blob/main/ROADMAP.md",
		"{{ site.repo_url }}/blob/main/CONTRIBUTING.md",
		"./guides/recommended-pi-stack.md",
		"./guides/ci-governance.md",
		"./guides/control-plane-operating-doctrine.md",
		"./architecture/",
		"./primitives/",
		"./engines/",
		"./research/0-8-readiness-map.md",
		"./site-map.md",
	]) {
		assert.match(index, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	assert.match(index, /This site is a curated entrypoint/);
});

test("site map documents promotion and publication boundaries", () => {
	const siteMap = read("docs/site-map.md");

	assert.match(siteMap, /Public Navigation/);
	assert.match(siteMap, /Publication Rules/);
	assert.match(siteMap, /Excluded from Jekyll/);
	assert.match(siteMap, /Promote operational material to `docs\/guides\/`, `docs\/primitives\/` or `docs\/architecture\/`/);
	assert.match(siteMap, /Do not publish `docs\/research\/data\/`/);
});
