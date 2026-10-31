// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

// NOTE: keep this module free of `vscode` imports so it can be unit tested with plain Node.

export type RunKind = "test" | "submit";

/** JSON emitted by resources/lc-run.js */
export interface IRunnerOutput {
    error?: string;
    internal?: boolean;
    kind?: RunKind;
    ok?: boolean;
    state?: string;
    lang?: string;
    runtime?: string;
    runtimePercentile?: number | string;
    memory?: string;
    memoryPercentile?: number | string;
    passed?: number;
    total?: number;
    submissionId?: string;
    testcase?: string;
    answers?: string[];
    expected?: string[];
    stdouts?: string[];
    stdoutText?: string;
    errors?: string[];
}

export interface ICaseResult {
    index: number;
    input: string[];
    output?: string;
    expected?: string;
    stdout: string;
    /** undefined when it cannot be decided (e.g. runtime error before the case finished) */
    passed?: boolean;
}

export interface IRunResult {
    id: string;
    kind: RunKind;
    fileName: string;
    timestamp: number;
    status: string;
    ok: boolean;
    lang?: string;
    runtime?: string;
    runtimePercentile?: string;
    memory?: string;
    memoryPercentile?: string;
    passed?: number;
    total?: number;
    errors: string[];
    cases: ICaseResult[];
    /** Input lines that could not be assigned to a single case. */
    sharedInput: string[];
    /** Stdout that could not be assigned to a single case (text fallback with several cases). */
    consoleText: string;
    source: "runner" | "cli-text";
}

export interface IRunContext {
    kind: RunKind;
    fileName: string;
    now?: number;
}

let counter: number = 0;
function nextId(now: number): string {
    counter += 1;
    return `${now.toString(36)}-${counter}`;
}

const normalize = (s: string | undefined): string => (s ?? "").trim();

export function splitLines(text: string | undefined): string[] {
    const lines: string[] = (text ?? "").replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

/**
 * LeetCode test input is a flat list of lines: `paramsPerCase` lines for every case.
 * When the lines cannot be divided evenly we keep them together instead of guessing.
 */
export function splitInputByCase(testcase: string | undefined, caseCount: number): { perCase: string[][]; shared: string[] } {
    const lines: string[] = splitLines(testcase);
    if (caseCount <= 1) {
        return { perCase: [lines], shared: [] };
    }
    if (lines.length > 0 && lines.length % caseCount === 0) {
        const size: number = lines.length / caseCount;
        const perCase: string[][] = [];
        for (let i: number = 0; i < caseCount; i++) {
            perCase.push(lines.slice(i * size, (i + 1) * size));
        }
        return { perCase, shared: [] };
    }
    return { perCase: Array.from({ length: caseCount }, () => []), shared: lines };
}

function toPercent(v: number | string | undefined): string | undefined {
    if (v === undefined || v === null || v === "") {
        return undefined;
    }
    const n: number = Number(v);
    return isFinite(n) ? `${n.toFixed(2)}%` : String(v);
}

export function buildRunResult(out: IRunnerOutput, ctx: IRunContext): IRunResult {
    const now: number = ctx.now ?? Date.now();
    const answers: string[] = out.answers ?? [];
    const expected: string[] = out.expected ?? [];
    const stdouts: string[] = out.stdouts ?? [];
    const caseCount: number = Math.max(answers.length, expected.length, 1);

    const { perCase, shared } = splitInputByCase(out.testcase, caseCount);
    const cases: ICaseResult[] = [];
    for (let i: number = 0; i < caseCount; i++) {
        const o: string | undefined = answers[i];
        const e: string | undefined = expected[i];
        cases.push({
            index: i,
            input: perCase[i] ?? [],
            output: o,
            expected: e,
            stdout: stdouts[i] ?? "",
            passed: o !== undefined && e !== undefined ? normalize(o) === normalize(e) : undefined,
        });
    }
    // stdout entries beyond the known cases (or a joined fallback) cannot be attributed to a case
    const leftover: string[] = stdouts.slice(caseCount).filter((s: string) => s !== "");
    if (out.stdoutText) {
        if (caseCount === 1 && !cases[0].stdout) {
            cases[0].stdout = out.stdoutText;
        } else {
            leftover.push(out.stdoutText);
        }
    }

    const errors: string[] = out.errors ?? [];
    const accepted: boolean = out.state === "Accepted";
    let status: string = out.state || (errors.length > 0 ? "Error" : "Finished");
    if (ctx.kind === "test" && accepted) {
        status = "Finished"; // "Accepted" in a test run only means the code ran
    }

    let ok: boolean = !!out.ok && errors.length === 0;
    if (ctx.kind === "test") {
        ok = ok && cases.every((c: ICaseResult) => c.passed !== false);
    }

    // a successful submission has no interesting case to show
    const shownCases: ICaseResult[] = ctx.kind === "submit" && ok ? [] : cases;

    return {
        id: nextId(now),
        kind: ctx.kind,
        fileName: ctx.fileName,
        timestamp: now,
        status,
        ok,
        lang: out.lang || undefined,
        runtime: out.runtime || undefined,
        runtimePercentile: toPercent(out.runtimePercentile),
        memory: out.memory || undefined,
        memoryPercentile: toPercent(out.memoryPercentile),
        passed: out.passed,
        total: out.total,
        errors,
        cases: shownCases,
        sharedInput: ctx.kind === "submit" && ok ? [] : shared,
        consoleText: leftover.join("\n"),
        source: "runner",
    };
}

// ---------------------------------------------------------------------------------------------------------
// Fallback: parse the plain text printed by vsc-leetcode-cli (used on WSL or when the runner is unavailable)
// ---------------------------------------------------------------------------------------------------------

export function parseCliText(raw: string, ctx: IRunContext): IRunResult {
    // eslint-disable-next-line no-control-regex
    const text: string = raw.replace(/\u001b\[[0-9;]*m/g, "").concat("  √ "); // strip colors, add sentinel
    const regSplit: RegExp = / {2}[√×✔✘vx] ([^]+?)\n(?= {2}[√×✔✘vx] )/g;
    const regKeyVal: RegExp = /(.+?): ([^]*)/;
    const messages: string[] = [];
    const values: { [key: string]: string[] } = {};

    let entry: RegExpExecArray | null = regSplit.exec(text);
    while (entry) {
        const kv: RegExpExecArray | null = regKeyVal.exec(entry[1]);
        if (kv) {
            // "Output (4 ms)" -> "output"
            const key: string = kv[1].replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
            if (kv[2]) {
                (values[key] = values[key] ?? []).push(kv[2]);
            }
        } else {
            messages.push(entry[1].trim());
        }
        entry = regSplit.exec(text);
    }

    let passed: number | undefined;
    let total: number | undefined;
    let runtime: string | undefined;
    let memory: string | undefined;
    let runtimePercentile: string | undefined;
    let memoryPercentile: string | undefined;
    for (const m of messages) {
        const cases: RegExpExecArray | null = /(\d+)\/(\d+) cases passed(?: \(([^)]*)\))?/.exec(m);
        if (cases) {
            passed = Number(cases[1]);
            total = Number(cases[2]);
            runtime = cases[3] || runtime;
        }
        const rt: RegExpExecArray | null = /runtime beats ([\d.]+) ?%/.exec(m);
        if (rt) {
            runtimePercentile = `${Number(rt[1]).toFixed(2)}%`;
        }
        const mem: RegExpExecArray | null = /memory usage beats ([\d.]+) ?%.*?(?:\(([^)]*)\))?\s*$/.exec(m);
        if (mem) {
            memoryPercentile = `${Number(mem[1]).toFixed(2)}%`;
            memory = mem[2] || memory;
        }
    }

    const outputs: string[] = values["output"] ?? values["answer"] ?? [];
    const expected: string[] = values["expected answer"] ?? [];
    const outputRuntime: RegExpExecArray | null = /Output \(([^)]*)\)/.exec(text);
    if (!runtime && outputRuntime) {
        runtime = outputRuntime[1];
    }
    const state: string = messages[0] ?? "";
    const accepted: boolean = state === "Accepted" || state === "Finished";
    const errors: string[] = values["error"] ?? [];

    const result: IRunResult = buildRunResult(
        {
            ok: accepted && errors.length === 0,
            state,
            runtime,
            memory,
            passed,
            total,
            testcase: (values["your input"] ?? values["testcase"] ?? [""])[0],
            answers: outputs,
            expected,
            stdouts: [],
            stdoutText: (values["stdout"] ?? []).join("\n"),
            errors,
        },
        ctx,
    );
    result.runtimePercentile = runtimePercentile;
    result.memoryPercentile = memoryPercentile;
    result.source = "cli-text";
    return result;
}

// ---------------------------------------------------------------------------------------------------------
// Plain text rendering, used for the "LeetCode" output channel
// ---------------------------------------------------------------------------------------------------------

export function formatRunForLog(r: IRunResult): string {
    const time: string = new Date(r.timestamp).toTimeString().slice(0, 8);
    const lines: string[] = [];
    const counts: string = r.total ? ` (${r.passed ?? 0}/${r.total} cases)` : "";
    lines.push(`[${time}] ${r.kind === "submit" ? "Submit" : "Test"} ${r.fileName}: ${r.status}${counts}`);
    if (r.runtime) {
        lines.push(`  Runtime: ${r.runtime}${r.runtimePercentile ? ` (beats ${r.runtimePercentile})` : ""}`);
    }
    if (r.memory) {
        lines.push(`  Memory: ${r.memory}${r.memoryPercentile ? ` (beats ${r.memoryPercentile})` : ""}`);
    }
    for (const e of r.errors) {
        lines.push("  Error:", ...splitLines(e).map((l: string) => `    ${l}`));
    }
    for (const c of r.cases) {
        const mark: string = c.passed === undefined ? "-" : c.passed ? "PASS" : "FAIL";
        lines.push(`  Case ${c.index + 1} [${mark}]`);
        if (c.input.length > 0) {
            lines.push(`    Input:    ${c.input.join(" | ")}`);
        }
        if (c.output !== undefined) {
            lines.push(`    Output:   ${c.output}`);
        }
        if (c.expected !== undefined) {
            lines.push(`    Expected: ${c.expected}`);
        }
        if (c.stdout) {
            lines.push("    Stdout:", ...splitLines(c.stdout).map((l: string) => `      ${l}`));
        }
    }
    if (r.consoleText) {
        lines.push("  Stdout (all cases):", ...splitLines(r.consoleText).map((l: string) => `    ${l}`));
    }
    return lines.join("\n");
}
