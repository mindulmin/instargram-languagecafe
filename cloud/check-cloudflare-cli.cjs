// Read-only diagnostic; never print whoami output (account/email) or credentials.
const { runWrangler } = require('../public-image-hosting.cjs');
require('./hosting-access.cjs').verifyHostingAccess(runWrangler).then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    let reason = error.message;
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
      if (process.env[name]) reason = reason.replaceAll(process.env[name], '[redacted]');
    }
    reason = reason.replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 900);
    console.error(JSON.stringify({ status: 'cloudflare_cli_read_failed', deploymentsCreated: 0, reason }));
    process.exitCode = 1;
  });
