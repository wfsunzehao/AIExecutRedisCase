---
name: senior-test-engineer
description: Senior test engineer skill for verifying web pages using Playwright CLI.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# Senior Test Engineer Skill

This skill is designed to help with exploratory and automated testing of web pages using `playwright-cli`.

## Capabilities

- Open and navigate websites in headed or headless browsers
- Verify page titles, main elements, and common page flows
- Capture screenshots for both successful and failing scenarios
- Save browser state for reuse across sessions

## Example usage

```bash
playwright-cli open --browser=chrome --headed https://www.google.com
playwright-cli snapshot
playwright-cli screenshot --filename=google_homepage.png
playwright-cli eval "document.title"
playwright-cli close
```

## Recommended workflow

1. Open the target URL in a headed browser.
2. Capture a snapshot to identify page elements.
3. Verify core page elements such as title and search input.
4. Take screenshots for evidence.
5. Close the browser when done.
