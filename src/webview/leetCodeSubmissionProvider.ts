// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { randomBytes } from "crypto";
import { ViewColumn } from "vscode";
import { leetCodeChannel } from "../leetCodeChannel";
import { formatRunForLog, IRunResult } from "../utils/resultUtils";
import { shouldLogRunsToOutputChannel } from "../utils/settingUtils";
import { openKeybindingsEditor, promptHintMessage } from "../utils/uiUtils";
import { ILeetCodeWebviewOption, LeetCodeWebview } from "./LeetCodeWebview";
import { renderRunHtml } from "./submissionHtml";

const MAX_HISTORY: number = 20;

class LeetCodeSubmissionProvider extends LeetCodeWebview {

    protected readonly viewType: string = "leetcode.submission";
    // newest first; kept for the whole session so earlier runs stay reachable after a new one
    private history: IRunResult[] = [];
    private selectedId: string | undefined;

    public show(run: IRunResult): void {
        this.history.unshift(run);
        this.history.length = Math.min(this.history.length, MAX_HISTORY);
        this.selectedId = run.id;
        if (shouldLogRunsToOutputChannel()) {
            leetCodeChannel.appendLine(formatRunForLog(run));
        }
        this.showWebviewInternal();
        this.showKeybindingsHint();
    }

    protected getWebviewOption(): ILeetCodeWebviewOption {
        const selected: IRunResult | undefined = this.history.find((r: IRunResult) => r.id === this.selectedId);
        return {
            title: selected?.kind === "test" ? "Test Result" : "Submission",
            viewColumn: ViewColumn.Two,
        };
    }

    protected getWebviewContent(): string {
        if (this.history.length === 0) {
            return "<!DOCTYPE html><html><body></body></html>";
        }
        const nonce: string = randomBytes(16).toString("base64");
        return renderRunHtml(this.history, this.selectedId, nonce, this.panel?.webview.cspSource ?? "");
    }

    protected async onDidReceiveMessage(message: { command: string; id?: string }): Promise<void> {
        switch (message.command) {
            case "select":
                if (this.panel && this.history.some((r: IRunResult) => r.id === message.id)) {
                    this.selectedId = message.id;
                    this.panel.title = this.getWebviewOption().title;
                    this.panel.webview.html = this.getWebviewContent();
                }
                break;
            case "openOutput":
                leetCodeChannel.show();
                break;
        }
    }

    protected onDidDisposeWebview(): void {
        super.onDidDisposeWebview();
    }

    private async showKeybindingsHint(): Promise<void> {
        await promptHintMessage(
            "hint.commandShortcut",
            'You can customize shortcut key bindings in File > Preferences > Keyboard Shortcuts with query "leetcode".',
            "Open Keybindings",
            (): Promise<any> => openKeybindingsEditor("leetcode solution"),
        );
    }
}

export const leetCodeSubmissionProvider: LeetCodeSubmissionProvider = new LeetCodeSubmissionProvider();
