// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as cp from "child_process";
import * as vscode from "vscode";
import { leetCodeChannel } from "../leetCodeChannel";

interface IExecError extends Error {
    result?: string;
}

export async function executeCommand(command: string, args: string[], options: cp.SpawnOptions = { shell: true }): Promise<string> {
    return new Promise((resolve: (res: string) => void, reject: (e: Error) => void): void => {
        let result: string = "";

        const childProc: cp.ChildProcess = cp.spawn(command, args, { ...options, env: createEnvOption() });

        childProc.stdout?.on("data", (data: string | Buffer) => {
            data = data.toString();
            result = result.concat(data);
            leetCodeChannel.append(data);
        });

        childProc.stderr?.on("data", (data: string | Buffer) => leetCodeChannel.append(data.toString()));

        childProc.on("error", reject);

        childProc.on("close", (code: number) => {
            if (code !== 0 || result.indexOf("ERROR") > -1) {
                const error: IExecError = new Error(`Command "${command} ${args.toString()}" failed with exit code "${code}".`);
                if (result) {
                    error.result = result; // leetcode-cli may print useful content by exit with error code
                }
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
}

export async function executeCommandWithProgress(message: string, command: string, args: string[], options: cp.SpawnOptions = { shell: true }): Promise<string> {
    let result: string = "";
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (p: vscode.Progress<{ message?: string }>) => {
        p.report({ message });
        result = await executeCommand(command, args, options);
    });
    return result;
}

/**
 * Run the structured runner (resources/lc-run.js). Unlike executeCommand this does not treat the word "ERROR"
 * in the output as a failure (user code may legitimately print it) and does not echo the JSON payload to the
 * output channel; only stderr is forwarded. The caller decides success from the payload itself.
 */
export async function executeRunner(command: string, args: string[], message: string): Promise<string> {
    let stdout: string = "";
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (p: vscode.Progress<{ message?: string }>) => {
        p.report({ message });
        stdout = await new Promise<string>((resolve: (out: string) => void, reject: (e: Error) => void): void => {
            const child: cp.ChildProcess = cp.spawn(command, args, { shell: true, env: createEnvOption() });
            let out: string = "";
            child.stdout?.on("data", (data: string | Buffer) => { out = out.concat(data.toString()); });
            child.stderr?.on("data", (data: string | Buffer) => leetCodeChannel.append(data.toString()));
            child.on("error", reject);
            child.on("close", () => resolve(out));
        });
    });
    return stdout;
}

// clone process.env and add http proxy
export function createEnvOption(): NodeJS.ProcessEnv {
    const proxy: string | undefined = getHttpAgent();
    if (proxy) {
        const env: any = Object.create(process.env);
        env.http_proxy = proxy;
        return env;
    }
    return process.env;
}

function getHttpAgent(): string | undefined {
    return vscode.workspace.getConfiguration("http").get<string>("proxy");
}
