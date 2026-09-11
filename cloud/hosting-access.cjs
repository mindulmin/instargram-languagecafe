const { checkCloudflare } = require('./check-cloudflare.cjs');
async function verifyHostingAccess(runWrangler, env = process.env, request = fetch) {
  // whoami can require account-wide settings not granted to a scoped Pages token.
  // Do not expand permissions: require the exact project's official GET instead.
  try { await runWrangler(['whoami']); return { status: 'cloudflare_cli_read_verified', deploymentsCreated: 0 }; }
  catch {
    const project = await checkCloudflare(env, request);
    if (project.status !== 'project_read_verified') throw Error('story_hosting_project_access_not_verified');
    return { status: 'scoped_project_read_verified_account_listing_unavailable', deploymentsCreated: 0 };
  }
}
module.exports = { verifyHostingAccess };
