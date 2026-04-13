#!/usr/bin/env python3
import json
import os
import platform
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_ID = os.environ.get("WEB_ROUTING_AB_RUN_ID", "run-2026-04-13")
TASKSET = os.environ.get("WEB_ROUTING_AB_TASKSET", "interactive-core")
OUT_DIR = ROOT / "docs" / "research" / "data" / "web-routing-ab" / RUN_ID
OUT_DIR.mkdir(parents=True, exist_ok=True)

TASKSETS = {
    "interactive-core": [
        {
            "id": "I1",
            "prompt": "Abra a documentação do Vitest, navegue até a página Guide > Mocking e retorne a URL exata da página final e 3 bullets.",
        },
        {
            "id": "I2",
            "prompt": "Abra npmjs do pacote vitest, vá para a seção de dependências e retorne 5 dependências.",
        },
        {
            "id": "I3",
            "prompt": "Abra o site vite.dev, navegue até o blog e encontre o post announcing vite 7, retornando título e URL final.",
        },
        {
            "id": "I4",
            "prompt": "Navegue pela documentação do TypeScript para a seção de tsconfig e resuma em 3 bullets a página final visitada com URL.",
        },
    ],
    "cloudflare-recheck": [
        {
            "id": "CF1",
            "prompt": (
                "Abra https://www.npmjs.com/package/vitest e extraia 5 dependências da seção Dependencies "
                "usando navegação de browser. Não use npm view nem endpoints do registry.npmjs.org."
            ),
        },
        {
            "id": "CF2",
            "prompt": (
                "Abra https://www.npmjs.com/package/typescript e retorne o título da página, URL final e 3 dados visíveis "
                "na interface web. Não use npm view nem endpoints do registry.npmjs.org."
            ),
        },
    ],
}

TASKS = TASKSETS.get(TASKSET, TASKSETS["interactive-core"])

ARMS = [
    {"id": "A", "name": "baseline", "append_system_prompt": None},
    {
        "id": "B",
        "name": "policy-strict",
        "append_system_prompt": (
            "Routing policy: for interactive web intents (open, navigate, click, fill, login), "
            "use web-browser skill first (CDP scripts). Only fallback to shell scraping if browser path fails. "
            "For non-interactive search/extraction, use web_search/fetch_content."
        ),
    },
]

PI_BIN = "pi.cmd" if platform.system().lower().startswith("win") else "pi"

CDP_PAT = re.compile(
    r"(web-browser[/\\]scripts|scripts[/\\](start|nav|eval|pick|screenshot|dismiss-cookies|watch|logs-tail|net-summary)\.js)",
    re.I,
)

DISALLOWED_PAT = re.compile(r"(npm\s+view|registry\.npmjs\.org)", re.I)


def parse_json_events(output: str):
    events = []
    for line in output.splitlines():
        s = line.strip()
        if not s.startswith("{"):
            continue
        try:
            events.append(json.loads(s))
        except Exception:
            continue
    return events


def extract_notify_answer(output: str) -> str:
    m = re.findall(r"\x1b\]777;notify;π;(.+?)\x07", output, flags=re.S)
    return m[-1].strip() if m else ""


def run_task(arm, task):
    cmd = [PI_BIN, "--no-session", "--mode", "json", "-p", task["prompt"]]
    if arm["append_system_prompt"]:
        cmd.extend(["--append-system-prompt", arm["append_system_prompt"]])

    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, timeout=420)
    elapsed = round(time.perf_counter() - t0, 2)

    stdout = (proc.stdout or b"").decode("utf-8", errors="ignore")
    stderr = (proc.stderr or b"").decode("utf-8", errors="ignore")
    output = stdout + ("\n" + stderr if stderr else "")

    events = parse_json_events(output)
    tools = []
    bash_cmds = []
    for e in events:
        if e.get("type") == "tool_execution_start":
            tname = e.get("toolName")
            if tname:
                tools.append(tname)
            if tname == "bash":
                cmd_s = (e.get("args") or {}).get("command", "")
                if cmd_s:
                    bash_cmds.append(cmd_s)

    answer = ""
    for e in reversed(events):
        if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant":
            texts = [
                p.get("text", "")
                for p in e.get("message", {}).get("content", [])
                if p.get("type") == "text"
            ]
            if texts:
                answer = "\n".join(texts).strip()
                break
    if not answer:
        answer = extract_notify_answer(output)

    cdp_path = any(CDP_PAT.search(c) for c in bash_cmds)
    used_extract_stack = any(t in ("web_search", "fetch_content", "get_search_content") for t in tools)
    disallowed_cmds = [c for c in bash_cmds if DISALLOWED_PAT.search(c)]

    return {
        "taskId": task["id"],
        "prompt": task["prompt"],
        "elapsedSec": elapsed,
        "exitCode": proc.returncode,
        "toolCalls": tools,
        "toolCallsUnique": sorted(set(tools)),
        "bashCommands": bash_cmds,
        "cdpPathDetected": cdp_path,
        "extractToolsDetected": used_extract_stack,
        "disallowedCommandsDetected": disallowed_cmds,
        "assistantAnswer": answer,
        "rawOutput": output,
    }


def main():
    run = {"runId": RUN_ID, "taskset": TASKSET, "arms": []}

    for arm in ARMS:
        arm_res = {"id": arm["id"], "name": arm["name"], "tasks": []}
        for task in TASKS:
            res = run_task(arm, task)
            arm_res["tasks"].append({k: v for k, v in res.items() if k != "rawOutput"})
            (OUT_DIR / f"{arm['id']}-{task['id']}.log").write_text(res["rawOutput"], encoding="utf-8")

        tasks = arm_res["tasks"]
        success = sum(1 for t in tasks if t["exitCode"] == 0 and (t["assistantAnswer"] or "").strip())
        cdp = sum(1 for t in tasks if t["cdpPathDetected"])
        fallback = sum(1 for t in tasks if (not t["cdpPathDetected"]) and ("bash" in t["toolCallsUnique"]))
        disallowed = sum(1 for t in tasks if t["disallowedCommandsDetected"])
        arm_res["metrics"] = {
            "taskCount": len(tasks),
            "successRate": round(success / len(tasks), 4) if tasks else 0,
            "avgElapsedSec": round(sum(t["elapsedSec"] for t in tasks) / len(tasks), 2) if tasks else 0,
            "cdpPathRate": round(cdp / len(tasks), 4) if tasks else 0,
            "fallbackRate": round(fallback / len(tasks), 4) if tasks else 0,
            "disallowedCommandRate": round(disallowed / len(tasks), 4) if tasks else 0,
        }
        run["arms"].append(arm_res)

    (OUT_DIR / "results.json").write_text(json.dumps(run, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    summary = {
        "runId": RUN_ID,
        "taskset": TASKSET,
        "arms": [
            {
                "id": a["id"],
                "name": a["name"],
                "metrics": a["metrics"],
            }
            for a in run["arms"]
        ],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
