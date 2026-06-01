# AI Credits Audit Reports

A GitHub Action that pulls down **premium request usage** billing data from a GitHub Enterprise account via the [Billing Reports REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/billing).

The API generates a CSV report asynchronously (typically ~3 minutes). This action submits the request, polls for completion, downloads the CSV, and exposes it as a workflow artifact.

## Prerequisites

- You must be a **GitHub Enterprise Cloud** admin or billing manager.
- Create a **PAT** (classic) or a **fine-grained token** with the `manage_billing:enterprise` scope.
- Store the token as a repository or organisation secret (e.g. `BILLING_TOKEN`).

## Usage

```yaml
- name: Download premium request report
  uses: abirismyname/ai-credits-audit-reports@main
  with:
    GITHUB_TOKEN: ${{ secrets.BILLING_TOKEN }}
    ent_name: my-enterprise
    start_date: '2025-01-01'
    end_date: '2025-01-31'
    csv_path: data/report.csv
```

See [`.github/workflows/example-usage.yml`](.github/workflows/example-usage.yml) for a complete scheduled workflow.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | ✅ | — | PAT with `manage_billing:enterprise` scope |
| `ent_name` | ✅ | — | Enterprise slug (e.g. `my-enterprise`) |
| `report_type` | | `premium_request` | Report type: `premium_request`, `detailed`, or `summarized` |
| `start_date` | ✅ | — | Start of the reporting window (`YYYY-MM-DD`) |
| `end_date` | | today | End of the reporting window (`YYYY-MM-DD`) |
| `csv_path` | | `data/report.csv` | Destination path for the downloaded CSV |
| `poll_interval_seconds` | | `30` | Seconds between status polls |
| `max_poll_attempts` | | `60` | Maximum polling attempts (~30 min total) |

### Report type date-range limits

| `report_type` | Max range |
|---|---|
| `premium_request` | 31 days |
| `detailed` | 31 days |
| `summarized` | 366 days |

## Outputs

| Output | Description |
|---|---|
| `csv_path` | Local path to the downloaded CSV |
| `report_id` | ID of the billing report on GitHub |

## Example: Upload as artifact

```yaml
- name: Download premium request report
  id: report
  uses: abirismyname/ai-credits-audit-reports@main
  with:
    GITHUB_TOKEN: ${{ secrets.BILLING_TOKEN }}
    ent_name: ${{ vars.ENTERPRISE_SLUG }}
    start_date: '2025-01-01'
    csv_path: data/premium-requests.csv

- name: Upload artifact
  uses: actions/upload-artifact@v4
  with:
    name: premium-requests-${{ github.run_id }}
    path: ${{ steps.report.outputs.csv_path }}
    retention-days: 90
```

## Example: Email a copy of the Premium Request Report

```yaml
name: Email Premium Request Report

on:
  workflow_dispatch:
  schedule:
    - cron: '0 9 1 * *' # 1st of every month at 9 AM UTC

jobs:
  report:
    runs-on: ubuntu-latest

    steps:
      - name: Download premium request report
        id: report
        uses: abirismyname/ai-credits-audit-reports@main
        with:
          GITHUB_TOKEN: ${{ secrets.BILLING_TOKEN }}
          ent_name: ${{ vars.ENTERPRISE_SLUG }}
          start_date: '2025-01-01'
          csv_path: data/premium-requests.csv

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: premium-requests-${{ github.run_id }}
          path: ${{ steps.report.outputs.csv_path }}
          retention-days: 90

      - name: Email report
        uses: dawidd6/action-send-mail@v3
        with:
          server_address: smtp.gmail.com
          server_port: 465
          username: ${{ secrets.EMAIL }}
          password: ${{ secrets.PASSWORD }}
          from: ${{ secrets.EMAIL }}
          to: ${{ secrets.EMAIL }}
          subject: "Premium Request Usage Report"
          html_body: |
            <!DOCTYPE html>
            <html>
            <body>
              <h1>Premium Request Usage Report</h1>
              <p>Attached is the latest premium request usage report for your enterprise.</p>
              <p>
                <a href="https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}">
                  View the full run on GitHub.com
                </a>
              </p>
            </body>
            </html>
          attachments: data/premium-requests.csv
```

## How it works

1. **POST** `/enterprises/{enterprise}/settings/billing/reports` — requests the CSV report.
2. **Poll** `GET /enterprises/{enterprise}/settings/billing/reports/{id}` every `poll_interval_seconds` until `status === "completed"`.
3. **Download** the pre-signed blob URL from `download_urls[0]` and save to `csv_path`.

## License

[MIT](LICENSE)
