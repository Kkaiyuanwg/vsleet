import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunResult, formatRunForLog, parseCliText, splitInputByCase } from "../src/utils/resultUtils";
import { escapeHtml, renderRunHtml } from "../src/webview/submissionHtml";

const ctx = { kind: "test" as const, fileName: "1.two-sum.py", now: 1_700_000_000_000 };

test("test run: every default case is listed with its own input, output and stdout", () => {
    const r = buildRunResult({
        ok: true, state: "Accepted",
        testcase: "[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6",
        answers: ["[0,1]", "[1,2]", "[0,1]"],
        expected: ["[0,1]", "[1,2]", "[1,0]"],
        stdouts: ["a\n", "", "c\nd\n"],
    }, ctx);
    assert.equal(r.status, "Finished"); // "Accepted" on a test run only means it ran
    assert.equal(r.cases.length, 3);
    assert.deepEqual(r.cases[0].input, ["[2,7,11,15]", "9"]);
    assert.deepEqual(r.cases[2].input, ["[3,3]", "6"]);
    assert.deepEqual(r.cases.map((c) => c.passed), [true, true, false]);
    assert.equal(r.cases[2].stdout, "c\nd\n");
    assert.equal(r.ok, false); // one case differs from expected
});

test("input that cannot be divided between cases is kept together, not guessed", () => {
    const { perCase, shared } = splitInputByCase("a\nb\nc", 2);
    assert.deepEqual(perCase, [[], []]);
    assert.deepEqual(shared, ["a", "b", "c"]);
});

test("failed submission shows the failing case with expected output and stdout", () => {
    const r = buildRunResult({
        ok: false, state: "Wrong Answer", passed: 10, total: 62, testcase: "[1,2]\n3",
        answers: ["[0]"], expected: ["[1]"], stdouts: ["debug line\n"],
    }, { ...ctx, kind: "submit" });
    assert.equal(r.status, "Wrong Answer");
    assert.equal(r.cases.length, 1);
    assert.equal(r.cases[0].passed, false);
    assert.equal(r.cases[0].stdout, "debug line\n");
});

test("accepted submission has no cases and keeps percentiles", () => {
    const r = buildRunResult({ ok: true, state: "Accepted", passed: 62, total: 62, runtime: "4 ms", runtimePercentile: 97.456, memory: "17 MB", memoryPercentile: 80 }, { ...ctx, kind: "submit" });
    assert.equal(r.ok, true);
    assert.equal(r.cases.length, 0);
    assert.equal(r.runtimePercentile, "97.46%");
});

test("runtime error is a failure even when the judge state says Accepted", () => {
    const r = buildRunResult({ ok: false, state: "Runtime Error", errors: ["Traceback..."], testcase: "1", answers: [], expected: [] }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.cases.length, 1);
});

test("text fallback: splits repeated Output / Expected lines into cases", () => {
    const raw = [
        "  √ Finished",
        "  √ Your Input: [2,7,11,15]",
        "9",
        "[3,2,4]",
        "6",
        "  √ Output (4 ms): [0,1]",
        "  √ Output (4 ms): [1,2]",
        "  √ Expected Answer: [0,1]",
        "  √ Expected Answer: [1,2]",
        "  √ Stdout: hello",
        "world",
        "",
    ].join("\n");
    const r = parseCliText(raw, ctx);
    assert.equal(r.source, "cli-text");
    assert.equal(r.cases.length, 2);
    assert.deepEqual(r.cases[1].input, ["[3,2,4]", "6"]);
    assert.equal(r.cases[1].passed, true);
    assert.equal(r.consoleText, "hello\nworld"); // cannot be attributed to a case in this mode
    assert.equal(r.runtime, "4 ms");
});

test("text fallback: submit accepted + wrong answer", () => {
    const ok = parseCliText("  √ Accepted\n  √ 62/62 cases passed (4 ms)\n  √ Your runtime beats 97.5 % of python3 submissions\n  √ Your memory usage beats 80 % of python3 submissions (17.2 MB)\n", { ...ctx, kind: "submit" });
    assert.equal(ok.ok, true);
    assert.equal(ok.passed, 62);
    assert.equal(ok.runtimePercentile, "97.50%");
    assert.equal(ok.memory, "17.2 MB");
    const bad = parseCliText("  × Wrong Answer\n  × 10/62 cases passed (N/A)\n  × Testcase: [1,2]\n3\n  × Answer: [0]\n  × Expected Answer: [1]\n  × Stdout: dbg\n", { ...ctx, kind: "submit" });
    assert.equal(bad.status, "Wrong Answer");
    assert.equal(bad.cases[0].expected, "[1]");
    assert.equal(bad.cases[0].stdout, "dbg");
});

test("html: escapes user stdout and offers history selection", () => {
    const a = buildRunResult({ ok: true, state: "Accepted", testcase: "1", answers: ["1"], expected: ["1"], stdouts: ["<script>alert(1)</script>"] }, ctx);
    const b = buildRunResult({ ok: false, state: "Wrong Answer", testcase: "1", answers: ["1"], expected: ["2"], stdouts: [""] }, { ...ctx, kind: "submit" });
    const html = renderRunHtml([b, a], a.id, "NONCE", "vscode-webview://x");
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes(`data-select="${b.id}"`) && html.includes(`data-select="${a.id}"`));
    assert.ok(html.includes("Stdout"));
    assert.ok(html.includes("script-src 'nonce-NONCE'"));
    assert.equal(escapeHtml(`"'&`), "&quot;&#39;&amp;");
});

test("log output contains per-case stdout", () => {
    const r = buildRunResult({ ok: true, state: "Accepted", testcase: "1", answers: ["1"], expected: ["1"], stdouts: ["hi\n"] }, ctx);
    const log = formatRunForLog(r);
    assert.ok(log.includes("Case 1 [PASS]") && log.includes("Stdout:") && log.includes("hi"));
});
