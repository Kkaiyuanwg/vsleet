"use strict";
/*
 * Structured test/submit runner.
 *
 * vsc-leetcode-cli prints human-oriented text where every test case is flattened and the stdout of all
 * cases is concatenated. This script drives the CLI's own `core` (same login/session/cache) but emits ONE
 * machine-readable JSON line, so the extension can show every case separately together with its stdout.
 *
 * Usage: node lc-run.js <cliRoot> <test|submit> <solutionFile> [testcaseFile]
 *
 * The result is printed as a line starting with MARK. Exit code is non-zero on failure. A payload with
 * `internal: true` means "this runner is incompatible/broken" and the extension falls back to the plain CLI.
 */
const fs = require("fs");
const path = require("path");

const MARK = "@@LC_RESULT@@";
const [root, kind, filename, testcaseFile] = process.argv.slice(2);

function finish(payload, code) {
    process.stdout.write("\n" + MARK + JSON.stringify(payload) + "\n", () => process.exit(code));
}
function internalError(e) {
    finish({ error: (e && e.message) || String(e), internal: true }, 2);
}
process.on("uncaughtException", internalError);
process.on("unhandledRejection", internalError);

if (!root || (kind !== "test" && kind !== "submit") || !filename) {
    internalError(new Error("usage: lc-run.js <cliRoot> <test|submit> <file> [testcaseFile]"));
    return;
}

// ---- capture the raw judge responses ------------------------------------------------------------------
// The CLI keeps only a lossy subset of the `check/` response (e.g. stdout of all cases joined into one
// string). Wrap `request` to keep the raw body of every finished judge task, keyed by submission id.
const rawByTask = {};
function sniff(body) {
    let o = body;
    if (typeof o === "string") {
        if (o.charAt(0) !== "{") { return; }
        o = JSON.parse(o);
    }
    if (o && o.state === "SUCCESS" && o.submission_id !== undefined) {
        rawByTask[String(o.submission_id)] = o;
    }
}
try {
    const reqPath = require.resolve("request", { paths: [root] });
    const real = require(reqPath);
    require.cache[reqPath].exports = new Proxy(real, {
        apply(target, thisArg, args) {
            const last = args.length - 1;
            if (typeof args[last] === "function") {
                const cb = args[last];
                args[last] = function (e, resp, body) {
                    try { sniff(body); } catch (_) { /* best effort */ }
                    return cb.apply(this, arguments);
                };
            }
            return Reflect.apply(target, thisArg, args);
        },
    });
} catch (_) { /* raw capture is best effort; formatted results still work */ }

// ---- boot the CLI exactly like lib/cli.js does --------------------------------------------------------
const lib = (m) => require(path.join(root, "lib", m));
const config = lib("config");
const chalk = lib("chalk");
const icon = lib("icon");
const log = lib("log");
const file = lib("file");
const cache = lib("cache");
const Plugin = lib("plugin");
const core = lib("core");
const session = lib("session");

config.init();
chalk.enabled = config.color.enable && chalk.enabled;
chalk.init();
chalk.setTheme(config.color.theme);
icon.init();
icon.setTheme(config.icon.theme);
log.init();
log.setLevel("WARN");
file.init();
file.mkdir(file.homeDir());

if (!Plugin.init()) {
    internalError(new Error("CLI plugins are not installed"));
    return;
}
Plugin.save();
cache.init();
session.argv = {};

// ---- helpers ------------------------------------------------------------------------------------------
const asList = (x) => (Array.isArray(x) ? x.map((v) => (v === null || v === undefined ? "" : String(v))) : []);
const asText = (x) => (x === null || x === undefined ? "" : String(x));
// CLI stores some strings through util.inspect(): 'a\nb' -> "'a\\nb'"
const uninspect = (s) => asText(s).replace(/^'([^]*)'$/, "$1").replace(/\\n/g, "\n");

function collectErrors(raw, formatted) {
    const out = [];
    const push = (v) => { if (v && out.indexOf(v) < 0) { out.push(String(v)); } };
    if (raw && (raw.full_compile_error || raw.full_runtime_error || raw.compile_error || raw.runtime_error)) {
        // prefer the long form; it contains the stack trace / compiler output
        push(raw.full_compile_error || raw.compile_error);
        push(raw.full_runtime_error || raw.runtime_error);
    } else {
        asList(formatted && formatted.error).forEach(push);
    }
    return out;
}

function common(r, raw) {
    return {
        ok: !!r.ok,
        state: asText(r.state || (raw && raw.status_msg)),
        lang: asText(r.lang),
        runtime: asText(r.runtime),
        runtimePercentile: r.runtime_percentile || "",
        memory: asText(r.memory),
        memoryPercentile: r.memory_percentile || "",
        passed: Number(r.passed) || 0,
        total: Number(r.total) || 0,
        submissionId: asText(r.id),
        errors: collectErrors(raw, r),
    };
}

function run() {
    if (!file.exist(filename)) {
        return finish({ error: "File " + filename + " does not exist" }, 1);
    }
    const meta = file.meta(filename);
    core.getProblem(meta.id, true, function (e, problem) {
        if (e) { return finish({ error: asText(e) }, 1); }
        problem.file = filename;
        problem.lang = meta.lang;
        return kind === "test" ? runTest(problem) : runSubmit(problem);
    });
}

function runTest(problem) {
    if (!problem.testable) {
        return finish({ error: "This problem is not testable, please submit directly." }, 1);
    }
    if (testcaseFile) {
        problem.testcase = fs.readFileSync(testcaseFile, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    }
    if (!problem.testcase) {
        return finish({ error: "Missing test case." }, 1);
    }
    core.testProblem(problem, function (e, results) {
        if (e) { return finish({ error: asText(e) }, 1); }
        results = results.slice().sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
        const r = results[0];
        const raw = rawByTask[String(r.id)] || null;
        const stdouts = raw ? (Array.isArray(raw.std_output_list) ? raw.std_output_list : raw.code_output) : null;
        const payload = common(r, raw);
        payload.kind = "test";
        payload.testcase = problem.testcase;
        payload.answers = asList(raw ? raw.code_answer : r.answer);
        // LeetCode-CN returns the expected answer as a separate task
        payload.expected = results[1] ? asList(results[1].answer) : asList(raw ? raw.expected_code_answer : r.expected_answer);
        payload.stdouts = asList(stdouts);
        // when raw capture failed we only have the CLI's joined stdout
        payload.stdoutText = raw ? "" : uninspect(r.stdout);
        return finish(payload, 0);
    });
}

function runSubmit(problem) {
    core.submitProblem(problem, function (e, results) {
        if (e) { return finish({ error: asText(e) }, 1); }
        const r = results[0];
        const raw = rawByTask[String(r.id)] || null;
        try {
            if (r.ok) {
                session.updateStat("ac", 1);
                session.updateStat("ac.set", problem.fid);
            }
            core.updateProblem(problem, { state: r.ok ? "ac" : "notac" });
        } catch (_) { /* local cache bookkeeping must not hide the verdict */ }
        const payload = common(r, raw);
        payload.kind = "submit";
        payload.testcase = raw && raw.last_testcase ? asText(raw.last_testcase) : uninspect(r.testcase);
        const out = raw ? raw.code_output : r.answer;
        const exp = raw ? raw.expected_output : r.expected_answer;
        payload.answers = Array.isArray(out) ? asList(out) : (asText(out) ? [asText(out)] : []);
        payload.expected = Array.isArray(exp) ? asList(exp) : (asText(exp) ? [asText(exp)] : []);
        payload.stdouts = raw ? (asText(raw.std_output) ? [asText(raw.std_output)] : []) : [];
        payload.stdoutText = raw ? "" : asText(r.stdout);
        return finish(payload, 0);
    });
}

try {
    run();
} catch (e) {
    internalError(e);
}
