#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "docs");
const SITE_DIR = path.join(DOCS_DIR, "_site");
const CONFIG_FILE = path.join(DOCS_DIR, "_config.yml");

const REQUIRED_ROUTES = [
	"/",
	"/start-here.html",
	"/site-map.html",
	"/architecture/",
	"/guides/",
	"/primitives/",
	"/engines/",
	"/research/",
	"/architecture/control-plane-runtime-map.html",
	"/guides/mermaid-authoring.html",
];

const REQUIRED_MERMAID_PAGES = [
	"/architecture/control-plane-runtime-map.html",
	"/architecture/provider-usage-tui-design.html",
	"/guides/mermaid-authoring.html",
];

const KNOWN_MERMAID_TYPES = [
	"architecture-beta",
	"block-beta",
	"c4context",
	"classDiagram",
	"erDiagram",
	"flowchart",
	"gantt",
	"gitGraph",
	"graph",
	"journey",
	"mindmap",
	"packet-beta",
	"pie",
	"quadrantChart",
	"requirementDiagram",
	"sequenceDiagram",
	"stateDiagram",
	"stateDiagram-v2",
	"timeline",
	"xyChart-beta",
];

const PUBLIC_LINK_ROUTES = [
	"/",
	"/start-here.html",
	"/site-map.html",
	"/architecture/",
	"/guides/",
	"/primitives/",
	"/engines/",
	"/research/",
	"/guides/recommended-pi-stack.html",
];

function read(file) {
	return readFileSync(file, "utf8");
}

function readConfiguredBaseurl() {
	const config = read(CONFIG_FILE);
	const match = /^baseurl:\s*(.*)$/m.exec(config);
	if (!match) return "";
	return match[1].trim().replace(/^["']|["']$/g, "");
}

function listHtmlFiles(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) listHtmlFiles(full, out);
		else if (entry.isFile() && entry.name.endsWith(".html")) out.push(full);
	}
	return out;
}

function routeToFile(route) {
	const clean = route.replace(/^\//, "").replace(/\/$/, "");
	if (!clean) return path.join(SITE_DIR, "index.html");
	if (route.endsWith("/")) return path.join(SITE_DIR, clean, "index.html");
	return path.join(SITE_DIR, clean);
}

function stripBaseurl(href, baseurl) {
	if (!baseurl) return href;
	if (href === baseurl || href === `${baseurl}/`) return "/";
	if (href.startsWith(`${baseurl}/`)) return href.slice(baseurl.length);
	return href;
}

function isExternal(href) {
	return /^(https?:|mailto:|tel:|#|data:)/.test(href);
}

function decodeHtml(value) {
	return value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function extractMermaidSources(html) {
	const sources = [];
	const codeRe = /<code class="language-mermaid">([\s\S]*?)<\/code>/g;
	for (const match of html.matchAll(codeRe)) {
		const source = decodeHtml(match[1].replace(/<[^>]*>/g, "")).trim();
		if (source) sources.push(source);
	}
	return sources;
}

function distExists(route) {
	const cleanRoute = route.split("#")[0].split("?")[0];
	if (!cleanRoute) return true;
	const target = routeToFile(cleanRoute);
	if (existsSync(target)) return true;
	const asIndex = path.join(SITE_DIR, cleanRoute.replace(/^\//, ""), "index.html");
	return existsSync(asIndex);
}

function collectLocalAssetReferences(html) {
	const refs = [];
	const patterns = [
		/<link\s[^>]*href="([^"]+)"/g,
		/<script\s[^>]*src="([^"]+)"/g,
		/<img\s[^>]*src="([^"]+)"/g,
	];
	for (const pattern of patterns) {
		for (const match of html.matchAll(pattern)) {
			const href = match[1];
			if (!href || isExternal(href)) continue;
			refs.push(href);
		}
	}
	return refs;
}

function collectLocalAnchorReferences(html) {
	const refs = [];
	for (const match of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
		const href = match[1];
		if (!href || isExternal(href)) continue;
		refs.push(href);
	}
	return refs;
}

function fail(errors) {
	console.error("docs-site-smoke: failed");
	for (const error of errors) console.error(`- ${error}`);
	process.exit(1);
}

const errors = [];
const baseurl = readConfiguredBaseurl();

if (!existsSync(SITE_DIR)) {
	fail(["docs/_site is missing; run pnpm run docs:site:build first."]);
}

for (const route of REQUIRED_ROUTES) {
	const file = routeToFile(route);
	if (!existsSync(file)) errors.push(`${route} is missing (${path.relative(ROOT, file)})`);
}

for (const route of REQUIRED_MERMAID_PAGES) {
	const file = routeToFile(route);
	if (!existsSync(file)) continue;
	const html = read(file);
	if (!html.includes("mermaid.esm.min.mjs")) {
		errors.push(`${route} is missing the Mermaid renderer hook`);
	}
	if (!html.includes("language-mermaid")) {
		errors.push(`${route} has no Mermaid source blocks`);
	}
	const sources = extractMermaidSources(html);
	if (sources.length === 0) errors.push(`${route} has no reconstructable Mermaid sources`);
	for (const [index, source] of sources.entries()) {
		if (!source.includes("\n")) errors.push(`${route} diagram ${index + 1} source lost newlines`);
		const firstLine = source.split(/\r?\n/)[0]?.trim() ?? "";
		if (!KNOWN_MERMAID_TYPES.some((type) => firstLine.startsWith(type))) {
			errors.push(`${route} diagram ${index + 1} starts with unknown Mermaid type '${firstLine}'`);
		}
	}
}

for (const file of listHtmlFiles(SITE_DIR)) {
	const rel = path.relative(SITE_DIR, file).replaceAll("\\", "/");
	const html = read(file);
	if (statSync(file).size < 500) errors.push(`${rel} is suspiciously small`);
}

for (const routePath of PUBLIC_LINK_ROUTES) {
	const file = routeToFile(routePath);
	if (!existsSync(file)) continue;
	const rel = path.relative(SITE_DIR, file).replaceAll("\\", "/");
	const html = read(file);
	if (/href="[^"]*README\.html/.test(html)) errors.push(`${rel} links to README.html instead of a directory route`);

	for (const href of collectLocalAnchorReferences(html)) {
		if (href.startsWith("//")) {
			errors.push(`${rel} contains protocol-relative href ${href}`);
			continue;
		}
		const route = stripBaseurl(href, baseurl);
		if (/\.md(?:[#?]|$)/.test(route)) errors.push(`${rel} links to raw Markdown route ${href}`);
		if (!distExists(route)) errors.push(`${rel} links to missing internal route ${href}`);
	}
}

for (const file of listHtmlFiles(SITE_DIR)) {
	const rel = path.relative(SITE_DIR, file).replaceAll("\\", "/");
	const html = read(file);

	for (const href of collectLocalAssetReferences(html)) {
		if (href.startsWith("//")) {
			errors.push(`${rel} contains protocol-relative href ${href}`);
			continue;
		}
		const route = stripBaseurl(href, baseurl);
		if (!distExists(route)) errors.push(`${rel} references missing local asset ${href}`);
	}
}

if (errors.length > 0) fail(errors);

console.log(`docs-site-smoke: OK (${listHtmlFiles(SITE_DIR).length} html files, baseurl=${baseurl || "/"})`);
