const fs = require('node:fs');
const path = require('node:path');
const PROJECT = 'language-cafe-instagram-assets';

// Read-only: never deploy, return response bodies, or log credentials/account IDs.
async function checkCloudflare(env = process.env, request = fetch) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const base = { project: PROJECT, deploymentsCreated: 0, writePermissionVerified: false };
  if (!token || !account) return { ...base, status: 'blocked_missing_credentials' };
  if (!/^[a-f0-9]{32}$/i.test(account)) return { ...base, status: 'blocked_account_id_format' };
  try {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    const matched = response.ok && body.success === true && body.result?.name === PROJECT;
    const errorCodes = [];
    const collectCodes = errors => {
      if (!Array.isArray(errors)) return;
      for (const error of errors) {
        if (Number.isSafeInteger(error?.code)) errorCodes.push(error.code);
        collectCodes(error?.error_chain);
      }
    };
    collectCodes(body?.errors);
    return { ...base, status: matched ? 'project_read_verified' : 'blocked_project_access', httpStatus: response.status, errorCodes };
  } catch {
    return { ...base, status: 'blocked_network_or_response' };
  }
}

if (require.main === module) checkCloudflare().then(result => {
  const file = path.join(__dirname, 'results/cloudflare-check.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Cloudflare connection\n\n${result.status}. Read-only check; no deployment or write-permission proof.\n`);
  if (result.status !== 'project_read_verified') process.exitCode = 1;
});
module.exports = { checkCloudflare };
