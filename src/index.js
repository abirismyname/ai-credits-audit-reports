const core = require('@actions/core');
const github = require('@actions/github');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { dirname } = require('path');
const makeDir = require('make-dir');

// Inputs
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const ent_Name = core.getInput('ent_name');
const report_type = 'ai_credits';
const start_date = core.getInput('start_date');
const csv_path = core.getInput('csv_path');
const poll_interval_ms = parseInt(core.getInput('poll_interval_seconds') || '30', 10) * 1000;
const max_poll_attempts = parseInt(core.getInput('max_poll_attempts') || '60', 10);

// Default end_date to today if not provided
const end_date = core.getInput('end_date') || new Date().toISOString().split('T')[0];

const octokit = github.getOctokit(GITHUB_TOKEN);

/**
 * POST the billing report request to GitHub's API.
 * Returns the report ID from the 202 response.
 */
async function createReport() {
  core.info(`Requesting ${report_type} report for enterprise "${ent_Name}" (${start_date} → ${end_date})`);
  const response = await octokit.request(
    'POST /enterprises/{enterprise}/settings/billing/reports',
    {
      enterprise: ent_Name,
      report_type,
      start_date,
      end_date,
      headers: { 'X-GitHub-Api-Version': '2022-11-28' }
    }
  );
  const reportId = response.data.id;
  core.info(`Report created. ID: ${reportId}`);
  return reportId;
}

/**
 * GET the report status. Returns the full data object.
 * Possible status values: processing, completed, failed
 */
async function getReportStatus(reportId) {
  const response = await octokit.request(
    'GET /enterprises/{enterprise}/settings/billing/reports/{report_id}',
    {
      enterprise: ent_Name,
      report_id: reportId,
      headers: { 'X-GitHub-Api-Version': '2022-11-28' }
    }
  );
  return response.data;
}

/**
 * Download a file from a URL (handles HTTP/HTTPS redirects) and save to dest.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    function fetchUrl(targetUrl) {
      proto.get(targetUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fetchUrl(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`Download failed with HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }

    fetchUrl(url);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  if (!ent_Name) {
    core.setFailed('ent_name is required');
    return;
  }
  if (!start_date) {
    core.setFailed('start_date is required');
    return;
  }

  try {
    await makeDir(dirname(csv_path));

    // Step 1: Request the report
    const reportId = await createReport();

    // Step 2: Poll until complete
    let downloadUrl = null;
    for (let attempt = 1; attempt <= max_poll_attempts; attempt++) {
      const data = await getReportStatus(reportId);
      core.info(`[Poll ${attempt}/${max_poll_attempts}] Status: ${data.status}`);

      if (data.status === 'completed') {
        if (!data.download_urls || data.download_urls.length === 0) {
          core.setFailed('Report completed but no download URLs were returned');
          return;
        }
        downloadUrl = data.download_urls[0];
        break;
      }

      if (data.status === 'failed') {
        core.setFailed(`Report generation failed (report ID: ${reportId})`);
        return;
      }

      if (attempt < max_poll_attempts) {
        core.info(`Waiting ${poll_interval_ms / 1000}s before next poll...`);
        await sleep(poll_interval_ms);
      }
    }

    if (!downloadUrl) {
      core.setFailed(
        `Timed out after ${max_poll_attempts} attempts. ` +
        `Report ID ${reportId} may still be processing.`
      );
      return;
    }

    // Step 3: Download the CSV
    core.info(`Downloading report to ${csv_path}...`);
    await downloadFile(downloadUrl, csv_path);
    core.info(`Report saved to ${csv_path}`);

    // Outputs for downstream steps
    core.setOutput('csv_path', csv_path);
    core.setOutput('report_id', String(reportId));
  } catch (error) {
    core.setFailed(error.message);
  }
}

core.info(`=== AI Credits Audit Report ===`);
core.info(`Enterprise: ${ent_Name}, Report: ${report_type}, Range: ${start_date} → ${end_date}`);
run();
