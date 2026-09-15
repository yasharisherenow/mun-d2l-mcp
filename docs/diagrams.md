# Editable Mermaid diagrams

The README diagrams are generated from Mermaid source. Mermaid calculates node
sizes, text placement, and connector routes; edit the source instead of positioning
individual text labels in an image.

- [Architecture source](assets/architecture.mmd)
- [Authentication lifecycle source](assets/authentication-flow.mmd)

## Edit in draw.io

Open [draw.io](https://app.diagrams.net/), choose **Arrange > Insert > Mermaid**
(or **+ > Mermaid**), and paste a source file's contents. Choose **Diagram** for
editable shapes. Menu wording can vary in older versions.
See [draw.io's Mermaid documentation](https://www.drawio.com/docs/manual/mermaid/).

The same source can be pasted into [Mermaid Live](https://mermaid.live/) or a
Markdown `mermaid` code block. Export SVG or PNG after editing, and update both
matching files in `docs/assets/`. The README uses SVG for crisp text at any zoom.

To reproduce the exports from the repository root using Mermaid CLI 11.12.0:

```powershell
$munBrowser = node --input-type=module -e "import { chromium } from 'playwright'; console.log(chromium.executablePath())"
$munPuppeteer = Join-Path $env:TEMP 'mun-mermaid-puppeteer.json'
@{ executablePath = $munBrowser } | ConvertTo-Json | Set-Content $munPuppeteer
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
foreach ($diagram in @('architecture', 'authentication-flow')) {
    foreach ($format in @('svg', 'png')) {
        npx --yes --package=@mermaid-js/mermaid-cli@11.12.0 mmdc -i "docs/assets/$diagram.mmd" -o "docs/assets/$diagram.$format" -c docs/assets/mermaid-config.json -p $munPuppeteer -b white -w 1600 -s 2
    }
}
```

This uses the Chromium installed during project setup. The diagram renderer is a
development tool downloaded on demand, not a runtime dependency of the MCP server.

## Meaning of the diagrams

Brightspace is outside the local Windows boundary. The connected MCP client
receives course data; normal server operation does not write that data into this
repository. Encryption keys remain in Windows Credential Manager.

Session age is checked when a tool request arrives; renewal is not an independent
background timer. Silent renewal verifies identity and enrollments before saving.
When fresh sign-in is required, the server returns `AUTH_REQUIRED`; it does not
open an interactive browser. Run `npm run login`, or use `npm run renew` to try
silent renewal with an interactive fallback. A failed renewal preserves the old
saved session but does not guarantee that session is still usable.

Logout deletes this app's encrypted session and key. It does not change your MUN
password or sign out other browsers.
