import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { PACKAGE_DOCS } from "../sync-package-docs.mjs";

function read(path) {
	return readFileSync(path, "utf8");
}

function internalRawMarkdownLinks(source) {
	return [...source.matchAll(/\]\(([^)]*\.md)\)/g)]
		.map((match) => match[1])
		.filter((href) => !href.startsWith("{{ site.repo_url }}"))
		.filter((href) => !href.startsWith("https://github.com/aretw0/agents-lab/blob/main/"));
}

function listMarkdownFiles(root) {
	const entries = readdirSync(root, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = join(root, entry.name);
		if (entry.isDirectory()) {
			if (["_site", "archive", "node_modules", "vendor"].includes(entry.name)) continue;
			if (normalize(fullPath).replaceAll("\\", "/").includes("docs/research/data")) continue;
			files.push(...listMarkdownFiles(fullPath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(normalize(fullPath).replaceAll("\\", "/"));
		}
	}
	return files;
}

function listPublishedMarkdownFiles() {
	return listMarkdownFiles("docs").filter((file) => read(file).match(/^---\r?\n/));
}

test("docs site uses the minimal Hacker Jekyll surface", () => {
	const config = read("docs/_config.yml");
	const gemfile = read("docs/Gemfile");
	const lockfile = read("docs/Gemfile.lock");
	const headCustom = read("docs/_includes/head-custom.html");

	assert.match(config, /^remote_theme: pages-themes\/hacker@v0\.2\.0$/m);
	assert.match(config, /^\s+- jekyll-remote-theme$/m);
	assert.match(config, /^\s+- jekyll-optional-front-matter$/m);
	assert.match(config, /^\s+- jekyll-readme-index$/m);
	assert.match(config, /^\s+- jekyll-titles-from-headings$/m);
	assert.match(config, /^baseurl: \/agents-lab$/m);
	assert.match(config, /^repo_url: https:\/\/github\.com\/aretw0\/agents-lab$/m);
	assert.match(config, /^\s+repository_url: https:\/\/github\.com\/aretw0\/agents-lab$/m);
	assert.match(config, /^\s+repository_nwo: aretw0\/agents-lab$/m);
	assert.match(gemfile, /gem "github-pages"/);
	assert.match(gemfile, /gem "jekyll-remote-theme"/);
	assert.match(lockfile, /github-pages \(232\)/);
	assert.match(lockfile, /jekyll-theme-hacker \(0\.2\.0\)/);
	assert.match(headCustom, /mermaid\.esm\.min\.mjs/);
	assert.match(headCustom, /pre > code\.language-mermaid/);
	assert.match(headCustom, /leaving source block unrendered/);
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
		"{{ '/guides/devcontainer-factory-contract.html' | relative_url }}",
		"{{ '/guides/ci-governance.html' | relative_url }}",
		"{{ '/guides/control-plane-operating-doctrine.html' | relative_url }}",
		"{{ '/architecture/' | relative_url }}",
		"{{ '/primitives/' | relative_url }}",
		"{{ '/engines/' | relative_url }}",
		"{{ '/site-map.html' | relative_url }}",
	]) {
		assert.match(index, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	assert.match(index, /This site is a curated entrypoint/);
	assert.doesNotMatch(index, /\/research\/0-8-readiness-map\.html/);
});

test("root README keeps user and maintainer surfaces separate", () => {
	const readme = read("README.md");

	const userStart = readme.indexOf("## Instalação");
	const maintainerStart = readme.indexOf("## Desenvolvimento");
	const qualityStart = readme.indexOf("## Gates De Qualidade");

	assert.ok(userStart > 0, "README needs a user installation section");
	assert.ok(maintainerStart > userStart, "development section should follow user installation");
	assert.ok(qualityStart > maintainerStart, "quality gates should stay in maintainer surface");
	assert.match(readme, /Para usuários Pi:/);
	assert.match(readme, /Terceiros Curados/);
	assert.doesNotMatch(readme, /incr[ií]vel|estado da arte|liberar o potencial|jornada/i);
});

test("root roadmap stays current and macro-level", () => {
	const roadmap = read("ROADMAP.md");

	assert.match(roadmap, /^# Roadmap - agents-lab$/m);
	assert.match(roadmap, /## 0\.8\.0 - Convergência/);
	assert.match(roadmap, /engine:boundary:audit/);
	assert.match(roadmap, /Refarm é a próxima fronteira de compatibilidade/);
	assert.match(roadmap, /sem exceções para core acoplado/);
	assert.doesNotMatch(roadmap, /reduzir a allowlist|acoplamentos Pi declarados/);
	assert.doesNotMatch(roadmap, /npm workspaces|Release `v0\.2\.0`|Fase 0|Fase 1|Fase 2|Fase 3|Fase 4/);
	assert.doesNotMatch(roadmap, /incr[ií]vel|estado da arte|liberar o potencial|jornada/i);
});

test("engine documentation matches the zero-exception boundary audit", () => {
	const engines = read("docs/engines/README.md");
	const readiness = read("docs/research/0-8-readiness-map.md");

	assert.match(engines, /falha quando um novo `guardrails-core-\*` importa runtime Pi diretamente/);
	assert.match(engines, /Pi em surfaces\/adapters|surface\/adapter/);
	assert.match(readiness, /Pi em surfaces\/adapters/);
	assert.doesNotMatch(`${engines}\n${readiness}`, /allowlist|acoplamento intencional|acoplamentos Pi declarados/);
});

test("public entrypoint pages do not route site readers to raw markdown", () => {
	for (const file of ["docs/index.md", "docs/start-here.md", "docs/site-map.md"]) {
		const source = read(file);
		const rawMarkdownLinks = internalRawMarkdownLinks(source);

		assert.deepEqual(rawMarkdownLinks, [], `${file} has internal raw markdown links`);
	}
});

test("published index pages do not route site readers to raw markdown", () => {
	for (const file of [
		"docs/guides/README.md",
		"docs/primitives/README.md",
		"docs/research/README.md",
		"docs/architecture/README.md",
		"docs/engines/README.md",
	]) {
		const source = read(file);
		const rawMarkdownLinks = internalRawMarkdownLinks(source);

		assert.deepEqual(rawMarkdownLinks, [], `${file} has internal raw markdown links`);
		assert.match(source, /^---\r?\n/, `${file} should render as an html index`);
	}
});

test("published front matter pages do not route site readers to raw markdown", () => {
	for (const file of listPublishedMarkdownFiles()) {
		const source = read(file);
		const rawMarkdownLinks = internalRawMarkdownLinks(source);

		assert.deepEqual(rawMarkdownLinks, [], `${file} has internal raw markdown links`);
	}
});

test("published Markdown escapes snippets that look like Liquid templates", () => {
	for (const file of listMarkdownFiles("docs")) {
		if (file.includes("/_site/") || file.includes("/archive/")) continue;
		const source = read(file);
		const rawProtected = source.replace(/\{% raw %\}[\s\S]*?\{% endraw %\}/g, "");
		const unsupportedLiquidSnippets = [...rawProtected.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
			.map((match) => match[1].trim())
			.filter((snippet) => snippet !== "site.repo_url")
			.filter((snippet) => !/^'\/[^']*'\s*\|\s*relative_url$/.test(snippet));

		assert.doesNotMatch(rawProtected, /\{\{\.[A-Za-z_]/, `${file} has an unescaped Go-template style snippet`);
		assert.deepEqual(unsupportedLiquidSnippets, [], `${file} has an unescaped Liquid-style template snippet`);
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
	assert.match(siteMap, /not the homepage/);
	assert.match(siteMap, /Do not publish `docs\/research\/data\/`/);
	assert.match(siteMap, /pnpm run docs:site:serve/);
	assert.match(siteMap, /`docs:site:build` mirrors the deploy target/);
	assert.match(siteMap, /`docs:site:smoke` validates the generated `_site` navigation/);
	assert.match(siteMap, /`docs:site:serve` uses local root/);
	assert.match(siteMap, /publishes `127\.0\.0\.1:4000:4000`/);
	assert.match(siteMap, /do not depend on VS Code auto-forwarding/);
	assert.match(siteMap, /http:\/\/127\.0\.0\.1:4000\//);
});

test("published documentation indexes keep audience boundaries explicit", () => {
	const guides = read("docs/guides/README.md");
	const primitives = read("docs/primitives/README.md");
	const research = read("docs/research/README.md");

	for (const heading of ["Operação da stack", "Operação do control plane", "Manutenção distribuível", "Manutenção do laboratório", "Evidência selecionada"]) {
		assert.match(guides, new RegExp(`### ${heading}`));
	}
	assert.match(guides, /[Nn]ão entram em pacotes distribuídos salvo decisão explícita/);
	assert.match(guides, /Research não é guia operacional por padrão/);
	assert.match(primitives, /não são ideias soltas/);
	assert.doesNotMatch(primitives, /🚧|em breve|Chain-of-Thought/i);
	assert.match(research, /não é contrato público nem documentação operacional/);
	assert.match(research, /Prefira guias, primitives e architecture para comportamento atual/);
	assert.doesNotMatch(research, /🚧|em construção|\|\s*Pendente\s*\|/i);
});

test("published primitives use operator terminology for local contracts", () => {
	const continuity = read("docs/primitives/nudge-free-local-continuity.md");

	assert.match(continuity, /local_slice_operator_contract_review/);
	assert.doesNotMatch(continuity, /local_slice_human_contract_review/);
	assert.doesNotMatch(continuity, /\bqueen\b/i);
});

test("package guide sync keeps lab-only maintenance out of distributed docs", () => {
	const packagedGuides = new Set(Object.values(PACKAGE_DOCS).flatMap((spec) => spec.guides));
	const labOnlyGuides = [
		"agents-lab-editorial-pipeline.md",
		"ci-governance.md",
		"doc-drift-mdt.md",
		"first-party-assimilation-notes.md",
		"github-repo-presence.md",
		"lab-user-surface-parity.md",
		"skill-guide-parity.md",
		"supply-chain-ci-hardening.md",
	];

	for (const guide of labOnlyGuides) {
		assert.equal(packagedGuides.has(guide), false, `${guide} should stay repository-only`);
	}
});

test("supply-chain CI hardening guide stays operational and repo-scoped", () => {
	const guides = read("docs/guides/README.md");
	const guide = read("docs/guides/supply-chain-ci-hardening.md");

	assert.match(guides, /supply-chain-ci-hardening\.html/);
	assert.match(guide, /repository maintenance material/);
	assert.match(guide, /`pnpm-workspace.yaml` owns `packages\/\*`, `minimumReleaseAge: 1440` and the explicit `allowBuilds` list/);
	assert.match(guide, /`pnpm install --frozen-lockfile`/);
	assert.match(guide, /Root scripts: workspace install, tests, audits, docs and release preparation use `pnpm`\/`pnpm exec`/);
	assert.match(guide, /`npm` use is intentional only for registry semantics/);
	assert.match(guide, /`npx` use is public installer UX for `@aretw0\/pi-stack`/);
	assert.match(guide, /GitHub Packages is not configured in the current publish workflow/);
	assert.match(guide, /`not-configured-opt-in`/);
	assert.match(guide, /cache-mode: \$\{\{ github\.event_name == 'pull_request' && 'off' \|\| 'auto' \}\}/);
	assert.match(guide, /pnpm install --frozen-lockfile --offline/);
	assert.match(guide, /pnpm run test:ci:workflow/);
	assert.match(guide, /pnpm run release:package:smoke/);
	assert.match(guide, /pnpm run ci:local:parity/);
	assert.match(guide, /package-manager rollback to npm as protected scope/);
	assert.match(guide, /do not retry manually until the release tag, package versions, provenance permission and npm token scope are rechecked/);
	assert.match(guide, /GitHub Packages regression/);
	assert.match(guide, /source-backed-pnpm-supply-chain-evidence-2026-05\.html/);
	assert.doesNotMatch(guide, /incr[ií]vel|estado da arte|liberar o potencial|jornada/i);
});

test("package guide sync includes generic maintenance guides", () => {
	assert.ok(PACKAGE_DOCS["@aretw0/lab-skills"].guides.includes("control-plane-glossary.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-skills"].guides.includes("control-plane-glossary.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-skills"].guides.includes("dependency-upstream-governance.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-skills"].guides.includes("mermaid-authoring.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-skills"].guides.includes("pi-platform-compatibility.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-skills"].guides.includes("terminal-setup.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("budget-governance.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("consumption-visibility-surfaces.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("dependency-upstream-governance.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("extension-acceptance-checklist.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("host-disk-recovery.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("mini-handoff-template.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("recommended-pi-stack.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("subagent-readiness-gate.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("swarm-preflight-15m.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/pi-stack"].guides.includes("token-efficiency.md"));
	assert.ok(PACKAGE_DOCS["@aretw0/lab-skills"].guides.includes("session-triage.md"));
});

test("Mermaid authoring separates portable skill rules from lab editorial policy", () => {
	const packageJson = JSON.parse(read("package.json"));
	const guide = read("docs/guides/mermaid-authoring.md");
	const packagedGuide = read("packages/pi-skills/docs/guides/mermaid-authoring.md");
	const skill = read("packages/pi-skills/skills/mermaid-authoring/SKILL.md");
	const architecture = read("docs/architecture/control-plane-runtime-map.md");

	assert.equal(packageJson.scripts["mermaid:check"], "node scripts/mermaid-check.mjs");
	assert.equal(packageJson.scripts["mermaid:check:lab"], "node scripts/mermaid-check.mjs --max-lines 80");
	assert.match(skill, /^name: mermaid-authoring$/m);
	assert.match(skill, /ASCII ids/);
	assert.match(skill, /Portuguese, accents and domain language in quoted labels/);
	assert.doesNotMatch(`${skill}\n${guide}\n${packagedGuide}`, /max-lines|small diagrams|diagramas pequenos|tamanho máximo/i);
	assert.match(architecture, /local editorial policy/);
	assert.match(architecture, /do not impose size/);
});

test("recommended stack guide stays user-first and concise", () => {
	const guide = read("docs/guides/recommended-pi-stack.md");

	assert.match(guide, /^# Stack Recomendada de Pi$/m);
	assert.ok(guide.indexOf("## Para usuários Pi") < guide.indexOf("## Para Mantenedores Do Repositório"));
	assert.match(guide, /Guias internos de CI, publicação e curadoria do laboratório/);
	assert.doesNotMatch(guide, /Stack Recomendada de Pi para o agents-lab/);
	assert.doesNotMatch(guide, /incr[ií]vel|estado da arte|liberar o potencial|jornada/i);
});

test("packaged guide markdown links resolve inside each package", () => {
	for (const spec of Object.values(PACKAGE_DOCS)) {
		const guideDir = join(spec.dir, "docs", "guides");
		if (!existsSync(guideDir)) continue;

		for (const fileName of readdirSync(guideDir).filter((entry) => entry.endsWith(".md"))) {
			const file = join(guideDir, fileName);
			const source = read(file);
			const links = [...source.matchAll(/\]\((\.{1,2}\/[^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]);

			for (const href of links) {
				const target = normalize(join(dirname(file), href));
				assert.equal(existsSync(target), true, `${file} links to missing packaged doc ${href}`);
			}
		}
	}
});

test("packaged guides render site-only Liquid links before distribution", () => {
	for (const spec of Object.values(PACKAGE_DOCS)) {
		const guideDir = join(spec.dir, "docs", "guides");
		if (!existsSync(guideDir)) continue;

		for (const fileName of readdirSync(guideDir).filter((entry) => entry.endsWith(".md"))) {
			const file = join(guideDir, fileName);
			const source = read(file);
			assert.doesNotMatch(source, /relative_url|site\.repo_url/, `${file} should not ship Jekyll-only links`);
		}
	}
});

test("package guide sync derives published URLs from Jekyll config", () => {
	const script = read("scripts/sync-package-docs.mjs");

	assert.match(script, /DOCS_CONFIG_PATH/);
	assert.match(script, /resolvePublishedDocsUrls/);
	assert.doesNotMatch(script, /SITE_BASE_URL|REPO_URL/);
	assert.doesNotMatch(script, /https:\/\/aretw0\.github\.io\/agents-lab/);
	assert.doesNotMatch(script, /https:\/\/github\.com\/aretw0\/agents-lab/);
});

test("docs site can be served consistently from host or devcontainer", () => {
	const packageJson = JSON.parse(read("package.json"));
	const script = read("scripts/docs-site.mjs");
	const smokeScript = read("scripts/docs-site-smoke.mjs");
	const devcontainer = JSON.parse(read(".devcontainer/devcontainer.json"));
	const dockerfile = read(".devcontainer/Dockerfile");
	const nodeVersion = read(".node-version").trim();
	const vscodeSettings = JSON.parse(read(".vscode/settings.json"));

	assert.equal(packageJson.scripts["docs:site:install"], "node scripts/docs-site.mjs install");
	assert.equal(packageJson.scripts["docs:site:build"], "node scripts/docs-site.mjs build");
	assert.equal(packageJson.scripts["docs:site:smoke"], "node scripts/docs-site-smoke.mjs");
	assert.equal(packageJson.scripts["docs:site:build:smoke"], "pnpm run docs:site:build && pnpm run docs:site:smoke");
	assert.equal(packageJson.scripts["docs:site:serve"], "node scripts/docs-site.mjs serve");
	assert.match(script, /BUNDLE_GEMFILE/);
	assert.match(script, /BUNDLE_PATH/);
	assert.match(script, /BUNDLE_APP_CONFIG/);
	assert.match(script, /BUNDLE_FROZEN/);
	assert.match(script, /\.cache", "bundle"/);
	assert.match(script, /bundle"\), \["check"\]/);
	assert.match(script, /SITE_DESTINATION = path\.join\(DOCS_DIR, "_site"\)/);
	assert.match(script, /cleanGeneratedSite/);
	assert.match(script, /rmSync\(SITE_DESTINATION, \{ recursive: true, force: true \}\)/);
	assert.match(script, /\["install", "--jobs", "4", "--retry", "3"\]/);
	assert.match(script, /Run once: pnpm run docs:site:install/);
	assert.match(script, /--site-mode=github-pages\|pages\|root/);
	assert.match(script, /SITE_MODES = new Set\(\["github-pages", "pages", "root"\]\)/);
	assert.match(script, /readConfiguredBaseurl/);
	assert.doesNotMatch(script, /SITE_MODES = new Map/);
	assert.doesNotMatch(script, /"\/agents-lab"\]/);
	assert.match(script, /existsSync\(CNAME_FILE\)/);
	assert.match(script, /serve: local root by default/);
	assert.match(script, /local-root/);
	assert.match(script, /"--baseurl",\s*baseurl/);
	assert.match(script, /"--baseurl",\s*serveBaseurl/);
	assert.match(script, /DOCS_SITE_BASEURL/);
	assert.match(script, /--host",\s*"0\.0\.0\.0"/);
	assert.match(script, /--port",\s*PORT/);
	assert.match(script, /Install Ruby\/Bundler, or rebuild the devcontainer/);
	assert.match(smokeScript, /REQUIRED_ROUTES/);
	assert.match(smokeScript, /"\/architecture\/"/);
	assert.match(smokeScript, /README\.html instead of a directory route/);
	assert.match(smokeScript, /mermaid\.esm\.min\.mjs/);
	assert.match(smokeScript, /collectLocalAssetReferences/);
	assert.match(smokeScript, /references missing local asset/);
	assert.match(smokeScript, /<link\\s\[\^>\]\*href/);
	assert.match(smokeScript, /<script\\s\[\^>\]\*src/);
	assert.match(smokeScript, /<img\\s\[\^>\]\*src/);
	assert.match(dockerfile, /ruby-full build-essential zlib1g-dev/);
	assert.match(dockerfile, /typescript-node:24-bookworm/);
	assert.match(dockerfile, /gem install bundler --no-document/);
	assert.equal(nodeVersion, "24");
	assert.ok(devcontainer.runArgs.includes("--publish"));
	assert.ok(devcontainer.runArgs.includes("127.0.0.1:4000:4000"));
	assert.deepEqual(devcontainer.forwardPorts, [4000]);
	assert.equal(devcontainer.portsAttributes["4000"].label, "agents-lab docs site");
	assert.equal(devcontainer.portsAttributes["4000"].onAutoForward, "openBrowser");
	assert.equal(vscodeSettings["remote.portsAttributes"]["4000"].label, "agents-lab docs site");
	assert.equal(vscodeSettings["remote.portsAttributes"]["4000"].onAutoForward, "openBrowser");
});
