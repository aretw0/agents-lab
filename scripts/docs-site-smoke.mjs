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
	return /^(https?:|mailto:|tel:|#)/.test(href);
}

function distExists(route) {
	const cleanRoute = route.split("#")[0].split("?")[0];
	if (!cleanRoute) return true;
	const target = routeToFile(cleanRoute);
	if (existsSync(target)) return true;
	const asIndex = path.join(SITE_DIR, cleanRoute.replace(/^\//, ""), "index.html");
	return existsSync(asIndex);
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

	for (const match of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
		const href = match[1];
		if (isExternal(href)) continue;
		if (href.startsWith("//")) {
			errors.push(`${rel} contains protocol-relative href ${href}`);
			continue;
		}
		const route = stripBaseurl(href, baseurl);
		if (/\.md(?:[#?]|$)/.test(route)) errors.push(`${rel} links to raw Markdown route ${href}`);
		if (route.startsWith("assets/") || route.startsWith("/assets/")) continue;
		if (!distExists(route)) errors.push(`${rel} links to missing internal route ${href}`);
	}
}

if (errors.length > 0) fail(errors);

console.log(`docs-site-smoke: OK (${listHtmlFiles(SITE_DIR).length} html files, baseurl=${baseurl || "/"})`);
