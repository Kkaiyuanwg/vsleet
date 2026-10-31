// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { leetCodeTreeDataProvider } from "../explorer/LeetCodeTreeDataProvider";
import { leetCodeExecutor, RunnerError } from "../leetCodeExecutor";
import { leetCodeManager } from "../leetCodeManager";
import { DialogType, promptForOpenOutputChannel, promptForSignIn } from "../utils/uiUtils";
import { getActiveFilePath } from "../utils/workspaceUtils";
import { leetCodeSubmissionProvider } from "../webview/leetCodeSubmissionProvider";

export async function submitSolution(uri?: vscode.Uri): Promise<void> {
    if (!leetCodeManager.getUser()) {
        promptForSignIn();
        return;
    }

    const filePath: string | undefined = await getActiveFilePath(uri);
    if (!filePath) {
        return;
    }

    try {
        leetCodeSubmissionProvider.show(await leetCodeExecutor.runSolution("submit", filePath));
    } catch (error) {
        const reason: string = error instanceof RunnerError ? ` ${error.message}.` : "";
        await promptForOpenOutputChannel(`Failed to submit the solution.${reason} Please open the output channel for details.`, DialogType.error);
        return;
    }

    leetCodeTreeDataProvider.refresh();
}
