import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

function read(path) {
	return readFileSync(path, "utf8");
}

test("docs site uses the minimal Hacker Jekyll surface", () => {
	const config = read("docs/_config.yml");
	const gemfile = read("docs/Gemfile");
	const lockfile = read("docs/Gemfile.lock");

	assert.match(config, /^remote_theme: pages-themes\/hacker@v0\.2\.0$/m);
	assert.match(config, /^\s+- jekyll-remote-theme$/m);
	assert.match(config, /^baseurl: \/agents-lab$/m);
	assert.match(config, /^repo_url: https:\/\/github\.com\/aretw0\/agents-lab$/m);
	assert.match(gemfile, /gem "github-pages"/);
	assert.match(gemfile, /gem "jekyll-remote-theme"/);
	assert.match(lockfile, /github-pages \(232\)/);
	assert.match(lockfile, /jekyll-theme-hacker \(0\.2\.0\)/);
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
		"{{ '/start-here.html' | relative_url }}",
		"{{ site.repo_url }}/blob/main/README.md",
		"{{ site.repo_url }}/blob/main/ROADMAP.md",
		"{{ site.repo_url }}/blob/main/CONTRIBUTING.md",
		"{{ '/guides/recommended-pi-stack.html' | relative_url }}",
		"{{ '/guides/ci-governance.html' | relative_url }}",
		"{{ '/guides/control-plane-operating-doctrine.html' | relative_url }}",
		"{{ '/architecture/README.html' | relative_url }}",
		"{{ '/primitives/README.html' | relative_url }}",
		"{{ '/engines/README.html' | relative_url }}",
		"{{ '/research/0-8-readiness-map.html' | relative_url }}",
		"{{ '/site-map.html' | relative_url }}",
	]) {
		assert.match(index, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	assert.match(index, /This site is a curated entrypoint/);
});

test("public entrypoint pages do not route site readers to raw markdown", () => {
	for (const file of ["docs/index.md", "docs/start-here.md", "docs/site-map.md"]) {
		const source = read(file);
		const rawMarkdownLinks = [...source.matchAll(/\]\(([^)]*\.md)\)/g)]
			.map((match) => match[1])
			.filter((href) => !href.startsWith("{{ site.repo_url }}"));

		assert.deepEqual(rawMarkdownLinks, [], `${file} has internal raw markdown links`);
	}
});

test("public entrypoint html links point to Jekyll-rendered sources", () => {
	for (const file of ["docs/index.md", "docs/start-here.md", "docs/site-map.md"]) {
		const source = read(file);
		const htmlLinks = [...source.matchAll(/\{\{\s*'\/([^']+\.html)'\s*\|\s*relative_url\s*\}\}/g)]
			.map((match) => match[1]);

		for (const href of htmlLinks) {
			const sourcePath = `docs/${href.replace(/\.html$/, ".md")}`;
			assert.equal(existsSync(sourcePath), true, `${file} links to missing source ${sourcePath}`);
			assert.match(read(sourcePath), /^---\r?\n/, `${sourcePath} needs front matter to render as html`);
		}
	}
});

test("site map documents promotion and publication boundaries", () => {
	const siteMap = read("docs/site-map.md");

	assert.match(siteMap, /Public Navigation/);
	assert.match(siteMap, /Publication Rules/);
	assert.match(siteMap, /Local Validation/);
	assert.match(siteMap, /Excluded from Jekyll/);
	assert.match(siteMap, /Promote operational material to `docs\/guides\/`, `docs\/primitives\/` or `docs\/architecture\/`/);
	assert.match(siteMap, /Do not publish `docs\/research\/data\/`/);
	assert.match(siteMap, /pnpm run docs:site:serve/);
	assert.match(siteMap, /If `docs\/CNAME` exists/);
	assert.match(siteMap, /http:\/\/127\.0\.0\.1:4000\/agents-lab\//);
});

test("docs site can be served consistently from host or devcontainer", () => {
	const packageJson = JSON.parse(read("package.json"));
	const script = read("scripts/docs-site.mjs");
	const devcontainer = JSON.parse(read(".devcontainer/devcontainer.json"));
	const dockerfile = read(".devcontainer/Dockerfile");
	const vscodeSettings = JSON.parse(read(".vscode/settings.json"));

	assert.equal(packageJson.scripts["docs:site:install"], "node scripts/docs-site.mjs install");
	assert.equal(packageJson.scripts["docs:site:build"], "node scripts/docs-site.mjs build");
	assert.equal(packageJson.scripts["docs:site:serve"], "node scripts/docs-site.mjs serve");
	assert.match(script, /BUNDLE_GEMFILE/);
	assert.match(script, /BUNDLE_PATH/);
	assert.match(script, /BUNDLE_APP_CONFIG/);
	assert.match(script, /BUNDLE_FROZEN/);
	assert.match(script, /\.cache", "bundle"/);
	assert.match(script, /bundle"\), \["check"\]/);
	assert.match(script, /\["install", "--jobs", "4", "--retry", "3"\]/);
	assert.match(script, /Run once: pnpm run docs:site:install/);
	assert.match(script, /--site-mode=github-pages\|root/);
	assert.match(script, /\["root", ""\]/);
	assert.match(script, /existsSync\(CNAME_FILE\)/);
	assert.match(script, /docs\/CNAME present: root deployment/);
	assert.match(script, /"--baseurl",\s*baseurl/);
	assert.match(script, /DOCS_SITE_BASEURL/);
	assert.match(script, /--host",\s*"0\.0\.0\.0"/);
	assert.match(script, /--port",\s*PORT/);
	assert.match(script, /Install Ruby\/Bundler, or rebuild the devcontainer/);
	assert.match(dockerfile, /ruby-full build-essential zlib1g-dev/);
	assert.match(dockerfile, /gem install bundler --no-document/);
	assert.deepEqual(devcontainer.forwardPorts, [4000]);
	assert.equal(devcontainer.portsAttributes["4000"].label, "agents-lab docs site");
	assert.equal(devcontainer.portsAttributes["4000"].onAutoForward, "openBrowser");
	assert.equal(vscodeSettings["remote.portsAttributes"]["4000"].label, "agents-lab docs site");
	assert.equal(vscodeSettings["remote.portsAttributes"]["4000"].onAutoForward, "openBrowser");
});
