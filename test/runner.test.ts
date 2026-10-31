import * as assert from "node:assert/strict";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

const MARK = "@@LC_RESULT@@";
const runner = path.join(__dirname, "..", "resources", "lc-run.js");

function write(p: string, content: string): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}

/** A tiny stand-in for vsc-leetcode-cli: same module layout, `core` talks to a fake `request`. */
function fakeCli(withCore: boolean = true): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fake-cli-"));
    const stub = (name: string, body: string): void => write(path.join(root, "lib", `${name}.js`), body);
    stub("config", "module.exports = { init(){}, color:{enable:false,theme:'x'}, icon:{theme:'x'} };");
    stub("chalk", "module.exports = { enabled:false, init(){}, setTheme(){} };");
    stub("icon", "module.exports = { init(){}, setTheme(){} };");
    stub("log", "module.exports = { init(){}, setLevel(){} };");
    stub("file", "module.exports = { init(){}, mkdir(){}, homeDir(){return '/tmp'}, exist(){return true}, meta(){return {id:'1',lang:'python3'}} };");
    stub("cache", "module.exports = { init(){} };");
    stub("plugin", "module.exports = { init(){return true}, save(){} };");
    stub("session", "module.exports = { updateStat(){} };");
    if (withCore) {
        stub("core", `
            const request = require('request');
            const base = { ok:true, lang:'python3', runtime:'', runtime_percentile:'', memory:'', memory_percentile:'', passed:0, total:0, error:[] };
            module.exports = {
                getProblem(id, tr, cb){ cb(null, { fid:1, testable:true, testcase:'[1]\\n2\\n[3]\\n4' }); },
                updateProblem(){},
                testProblem(problem, cb){ request({ url:'check' }, (e, r, body) => {
                    const o = JSON.parse(body);
                    cb(null, [Object.assign({}, base, { type:'Actual', id:o.submission_id, state:'Accepted', answer:o.code_answer, expected_answer:o.expected_code_answer, stdout:"'JOINED'" })]);
                }); },
                submitProblem(problem, cb){ request({ url:'check' }, (e, r, body) => {
                    const o = JSON.parse(body);
                    cb(null, [Object.assign({}, base, { type:'Actual', id:o.submission_id, ok:false, state:'Wrong Answer', passed:1, total:3, testcase:"'x'", answer:o.code_output, expected_answer:o.expected_output, stdout:o.std_output })]);
                }); },
            };`);
    }
    const body = (extra: object): string => JSON.stringify({ state: "SUCCESS", submission_id: "runcode_1", run_success: true, ...extra });
    write(path.join(root, "node_modules", "request", "index.js"), `
        module.exports = function (opts, cb) {
            const kind = process.env.FAKE_KIND;
            const body = kind === 'submit' ? ${JSON.stringify(body({ code_output: "[0]", expected_output: "[1]", std_output: "dbg\n", last_testcase: "[3,3]\n6" }))}
                : ${JSON.stringify(body({ code_answer: ["[0,1]", "[1,2]"], expected_code_answer: ["[0,1]", "[2,1]"], std_output_list: ["hello\n", "p1\np2\n"], code_output: [] }))};
            setImmediate(() => cb(null, { statusCode: 200 }, body));
        };`);
    return root;
}

function run(root: string, kind: string, env: object = {}): any {
    const caseFile = path.join(root, "case.txt");
    fs.writeFileSync(caseFile, "[1]\r\n2\r\n[3]\r\n4\r\n");
    const res = cp.spawnSync(process.execPath, [runner, root, kind, "/tmp/1.two-sum.py", caseFile], { encoding: "utf8", env: { ...process.env, ...env } });
    const line = res.stdout.split("\n").find((l) => l.startsWith(MARK));
    assert.ok(line, `no result line; stderr=${res.stderr}`);
    return JSON.parse(line.slice(MARK.length));
}

test("runner returns per-case answers, expected and stdout from the raw judge response", () => {
    const out = run(fakeCli(), "test", { FAKE_KIND: "test" });
    assert.equal(out.kind, "test");
    assert.deepEqual(out.answers, ["[0,1]", "[1,2]"]);
    assert.deepEqual(out.expected, ["[0,1]", "[2,1]"]);
    assert.deepEqual(out.stdouts, ["hello\n", "p1\np2\n"]); // not the CLI's single joined string
    assert.equal(out.testcase, "[1]\n2\n[3]\n4");
    assert.equal(out.stdoutText, "");
});

test("runner submit returns the failing case with its stdout", () => {
    const out = run(fakeCli(), "submit", { FAKE_KIND: "submit" });
    assert.equal(out.kind, "submit");
    assert.equal(out.state, "Wrong Answer");
    assert.equal(out.testcase, "[3,3]\n6");
    assert.deepEqual(out.answers, ["[0]"]);
    assert.deepEqual(out.expected, ["[1]"]);
    assert.deepEqual(out.stdouts, ["dbg\n"]);
});

test("runner flags itself as internal-error when the CLI layout is incompatible", () => {
    const out = run(fakeCli(false), "test");
    assert.equal(out.internal, true); // the extension falls back to the plain CLI on this
});
