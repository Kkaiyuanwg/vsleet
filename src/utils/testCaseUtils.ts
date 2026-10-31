// Copyright (c) jdneo. All rights reserved.
// Licensed under the MIT license.

import { isWindows, usingCmd } from "./osUtils";
import * as wsl from "./wslUtils";

/**
 * Quote a (real-newline) test case for `leetcode test -t <case>` when it goes through a shell.
 * Only used by the plain CLI fallback; the structured runner reads the test case from a file.
 */
export function quoteTestCase(testcase: string): string {
    const test: string = testcase.replace(/\r?\n/g, "\\n");
    if (wsl.useWsl() || !isWindows()) {
        return `'${test}'`;
    }
    // In windows and not using WSL
    if (usingCmd()) {
        return `"${test.replace(/"/g, '\\"')}"`;
    }
    // Assume using PowerShell
    return `'${test.replace(/"/g, '\\"')}'`;
}
