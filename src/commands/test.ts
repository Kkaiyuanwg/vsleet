// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as fse from "fs-extra";
import * as vscode from "vscode";
import { leetCodeExecutor, RunnerError } from "../leetCodeExecutor";
import { leetCodeManager } from "../leetCodeManager";
import { IQuickItemEx, UserStatus } from "../shared";
import { IRunResult } from "../utils/resultUtils";
import { DialogType, promptForOpenOutputChannel, showFileSelectDialog } from "../utils/uiUtils";
import { getActiveFilePath } from "../utils/workspaceUtils";
import { leetCodeSubmissionProvider } from "../webview/leetCodeSubmissionProvider";

export async function testSolution(uri?: vscode.Uri): Promise<void> {
    try {
        if (leetCodeManager.getStatus() === UserStatus.SignedOut) {
            return;
        }

        const filePath: string | undefined = await getActiveFilePath(uri);
        if (!filePath) {
            return;
        }
        const picks: Array<IQuickItemEx<string>> = [];
        picks.push(
            {
                label: "$(three-bars) Default test cases",
                description: "",
                detail: "Test with the default cases",
                value: ":default",
            },
            {
                label: "$(pencil) Write directly...",
                description: "",
                detail: "Write test cases in input box",
                value: ":direct",
            },
            {
                label: "$(file-text) Browse...",
                description: "",
                detail: "Test with the written cases in file",
                value: ":file",
            },
        );
        const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
        if (!choice) {
            return;
        }

        let result: IRunResult | undefined;
        switch (choice.value) {
            case ":default":
                result = await leetCodeExecutor.runSolution("test", filePath);
                break;
            case ":direct": {
                const testString: string | undefined = await vscode.window.showInputBox({
                    prompt: "Enter the test cases.",
                    validateInput: (s: string): string | undefined => s && s.trim() ? undefined : "Test case must not be empty.",
                    placeHolder: "Example: [1,2,3]\\n4",
                    ignoreFocusOut: true,
                });
                if (testString) {
                    // the input box takes a literal "\\n" as the separator between lines
                    result = await leetCodeExecutor.runSolution("test", filePath, testString.replace(/\\n/g, "\n"));
                }
                break;
            }
            case ":file": {
                const testFile: vscode.Uri[] | undefined = await showFileSelectDialog(filePath);
                if (testFile && testFile.length) {
                    const input: string = (await fse.readFile(testFile[0].fsPath, "utf-8")).trim();
                    if (input) {
                        result = await leetCodeExecutor.runSolution("test", filePath, input);
                    } else {
                        vscode.window.showErrorMessage("The selected test file must not be empty.");
                    }
                }
                break;
            }
            default:
                break;
        }
        if (!result) {
            return;
        }
        leetCodeSubmissionProvider.show(result);
    } catch (error) {
        const reason: string = error instanceof RunnerError ? ` ${error.message}.` : "";
        await promptForOpenOutputChannel(`Failed to test the solution.${reason} Please open the output channel for details.`, DialogType.error);
    }
}
