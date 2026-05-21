import test from "node:test";
import assert from "node:assert/strict";

import {
  checkMermaidBlock,
  extractMermaidBlocks,
} from "../mermaid-check.mjs";

test("extractMermaidBlocks finds fenced Mermaid blocks with source line", () => {
  const blocks = extractMermaidBlocks([
    "# Doc",
    "",
    "text",
    "```mermaid",
    "graph LR",
    "  A --> B",
    "```",
  ].join("\n"));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].line, 4);
  assert.match(blocks[0].body, /graph LR/);
});

test("checkMermaidBlock accepts Portuguese labels behind ASCII node ids", () => {
  const findings = checkMermaidBlock([
    "graph LR",
    "  entrada[\"Entrada em português\"] --> saida[\"Saída com ação\"]",
  ].join("\n"));

  assert.deepEqual(findings, []);
});

test("checkMermaidBlock reports non-ASCII flowchart ids", () => {
  const findings = checkMermaidBlock([
    "graph LR",
    "  Entrada --> Saida",
    "  Organização --> Revisão",
  ].join("\n"));

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /non-ASCII node id/);
});

test("checkMermaidBlock reports wikilinks inside edge labels", () => {
  const findings = checkMermaidBlock([
    "graph LR",
    "  A -->|[[Link]]| B",
  ].join("\n"));

  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /wikilink/);
});

test("checkMermaidBlock does not enforce diagram size unless requested", () => {
  const body = [
    "graph LR",
    "  A --> B",
    "  B --> C",
    "  C --> D",
  ].join("\n");

  assert.deepEqual(checkMermaidBlock(body), []);

  const findings = checkMermaidBlock(body, { maxLines: 2 });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /split it before 2/);
});
