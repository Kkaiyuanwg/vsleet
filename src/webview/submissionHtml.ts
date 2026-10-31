// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

// NOTE: keep this module free of `vscode` imports so it can be unit tested with plain Node.

import { ICaseResult, IRunResult } from "../utils/resultUtils";

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const STYLE: string = `
    :root { --ok: var(--vscode-testing-iconPassed, #3fb950); --bad: var(--vscode-testing-iconFailed, #f85149); --dim: var(--vscode-descriptionForeground); --line: var(--vscode-panel-border, rgba(128,128,128,.35)); }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 20px 40px; line-height: 1.45; }
    h1 { font-size: 1.6em; margin: 0; font-weight: 600; }
    h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); margin: 14px 0 4px; font-weight: 600; }
    code, pre { font-family: var(--vscode-editor-font-family, monospace); font-size: var(--vscode-editor-font-size, 13px); }
    pre { margin: 0; padding: 8px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
    .history { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--line); }
    .chip { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 3px 9px; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px; }
    .chip:hover { background: var(--vscode-toolbar-hoverBackground); }
    .chip.sel { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--dim); }
    .ok .dot, .dot.ok { background: var(--ok); } .bad .dot, .dot.bad { background: var(--bad); }
    .verdict { display: flex; align-items: center; gap: 10px; } .verdict .dot { width: 12px; height: 12px; }
    .verdict.ok h1 { color: var(--ok); } .verdict.bad h1 { color: var(--bad); }
    .meta { color: var(--dim); margin: 2px 0 12px; font-size: 12px; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
    .stat { border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; min-width: 120px; }
    .stat b { display: block; font-size: 1.25em; } .stat span { color: var(--dim); font-size: 12px; }
    .err pre { border-left: 3px solid var(--bad); }
    details.case { border: 1px solid var(--line); border-radius: 6px; margin: 8px 0; }
    details.case > summary { cursor: pointer; padding: 8px 12px; display: flex; align-items: center; gap: 8px; font-weight: 600; list-style-position: inside; }
    details.case.pass > summary { border-left: 3px solid var(--ok); } details.case.fail > summary { border-left: 3px solid var(--bad); }
    details.case .body { padding: 0 12px 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 14px; }
    .row { position: relative; }
    .copy { position: absolute; top: 2px; right: 2px; opacity: 0; border: 0; border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .row:hover .copy { opacity: 1; }
    .console pre { background: var(--vscode-terminal-background, var(--vscode-editor-background)); border: 1px solid var(--line); color: var(--vscode-terminal-foreground, var(--vscode-foreground)); }
    .empty { color: var(--dim); font-style: italic; font-size: 12px; }
    .diff pre { border-left: 3px solid var(--bad); } .same pre { border-left: 3px solid var(--ok); }
    button.link { background: none; border: 0; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; font: inherit; }
    .toolbar { margin-top: 18px; }
`;

const SCRIPT: string = `
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", (ev) => {
        const t = ev.target.closest("[data-select],[data-copy],[data-open-output]");
        if (!t) { return; }
        if (t.dataset.select) { vscode.postMessage({ command: "select", id: t.dataset.select }); }
        else if (t.dataset.openOutput !== undefined) { vscode.postMessage({ command: "openOutput" }); }
        else if (t.dataset.copy) {
            const el = document.getElementById(t.dataset.copy);
            if (el && navigator.clipboard) { navigator.clipboard.writeText(el.textContent || ""); t.textContent = "Copied"; setTimeout(() => { t.textContent = "Copy"; }, 1200); }
        }
    });
`;

let blockCounter: number = 0;

function block(label: string, text: string, cls: string = ""): string {
    blockCounter += 1;
    const id: string = `b${blockCounter}`;
    return `<div class="row ${cls}"><h3>${escapeHtml(label)}</h3><pre id="${id}">${escapeHtml(text)}</pre><button class="copy" data-copy="${id}">Copy</button></div>`;
}

function renderCase(c: ICaseResult, total: number, open: boolean): string {
    const cls: string = c.passed === undefined ? "" : c.passed ? "pass" : "fail";
    const mark: string = c.passed === undefined ? "" : c.passed ? "✓ Passed" : "✗ Failed";
    const parts: string[] = [];
    if (c.input.length > 0) {
        parts.push(block("Input", c.input.join("\n")));
    }
    if (c.output !== undefined) {
        parts.push(block("Output", c.output, c.passed === false ? "diff" : c.passed ? "same" : ""));
    }
    if (c.expected !== undefined) {
        parts.push(block("Expected", c.expected));
    }
    const grid: string = parts.length > 0 ? `<div class="grid">${parts.join("")}</div>` : "";
    const stdout: string = c.stdout
        ? `<div class="console">${block("Stdout", c.stdout)}</div>`
        : "";
    const label: string = total > 1 ? `Case ${c.index + 1}` : "Case";
    return `<details class="case ${cls}"${open ? " open" : ""}><summary><span>${label}</span><span class="${c.passed ? "ok" : c.passed === false ? "bad" : ""}" style="font-weight:400">${mark}</span></summary><div class="body">${grid}${stdout}</div></details>`;
}

export function renderRunHtml(history: IRunResult[], selectedId: string | undefined, nonce: string, cspSource: string): string {
    blockCounter = 0;
    const run: IRunResult = history.find((r: IRunResult) => r.id === selectedId) ?? history[0];
    const tone: string = run.ok ? "ok" : "bad";

    const chips: string = history.map((r: IRunResult) => {
        const time: string = new Date(r.timestamp).toTimeString().slice(0, 8);
        return `<button class="chip ${r.id === run.id ? "sel" : ""}" data-select="${escapeHtml(r.id)}" title="${escapeHtml(r.fileName)}"><span class="dot ${r.ok ? "ok" : "bad"}"></span>${r.kind === "submit" ? "Submit" : "Test"} · ${escapeHtml(r.status)} · ${time}</button>`;
    }).join("");

    const stats: string[] = [];
    if (run.total) {
        stats.push(`<div class="stat"><b>${run.passed ?? 0} / ${run.total}</b><span>cases passed</span></div>`);
    } else if (run.cases.length > 0) {
        const okCount: number = run.cases.filter((c: ICaseResult) => c.passed).length;
        stats.push(`<div class="stat"><b>${okCount} / ${run.cases.length}</b><span>cases match expected</span></div>`);
    }
    if (run.runtime) {
        stats.push(`<div class="stat"><b>${escapeHtml(run.runtime)}</b><span>runtime${run.runtimePercentile ? ` · beats ${escapeHtml(run.runtimePercentile)}` : ""}</span></div>`);
    }
    if (run.memory) {
        stats.push(`<div class="stat"><b>${escapeHtml(run.memory)}</b><span>memory${run.memoryPercentile ? ` · beats ${escapeHtml(run.memoryPercentile)}` : ""}</span></div>`);
    }

    const errors: string = run.errors.map((e: string) => `<div class="err">${block("Error", e)}</div>`).join("");
    const shared: string = run.sharedInput.length > 0 ? block("Input (all cases)", run.sharedInput.join("\n")) : "";
    const open: (i: number) => boolean = (i: number) => run.cases.length <= 3 || run.cases[i].passed === false;
    const cases: string = run.cases.map((c: ICaseResult, i: number) => renderCase(c, run.cases.length, open(i))).join("");
    const consoleAll: string = run.consoleText ? `<div class="console">${block("Stdout (all cases, in order)", run.consoleText)}</div>` : "";
    const anyStdout: boolean = run.consoleText !== "" || run.cases.some((c: ICaseResult) => c.stdout !== "");
    const noStdout: string = !anyStdout && run.errors.length === 0 && run.kind === "test"
        ? `<p class="empty">Nothing was printed to stdout.</p>`
        : "";

    const when: string = new Date(run.timestamp).toLocaleTimeString();
    const meta: string = [run.kind === "submit" ? "Submit" : "Test", run.fileName, run.lang, when].filter(Boolean).map((x: string | undefined) => escapeHtml(String(x))).join(" · ");
    const note: string = run.source === "cli-text"
        ? `<p class="empty">Shown from the plain CLI output, so stdout of several cases may be merged.</p>`
        : "";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="history">${chips}</div>
<div class="verdict ${tone}"><span class="dot"></span><h1>${escapeHtml(run.status)}</h1></div>
<div class="meta">${meta}</div>
<div class="stats">${stats.join("")}</div>
${errors}${shared}${cases}${consoleAll}${noStdout}${note}
<div class="toolbar"><button class="link" data-open-output>Open LeetCode output panel</button></div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
