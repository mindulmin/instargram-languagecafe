const REPOSITORY = 'mindulmin/instargram-languagecafe';
const BRANCH = 'cloud-state';
class GitHubState {
  constructor(token, request = fetch) { this.token = token; this.request = request; }
  async api(route, method = 'GET', body) {
    if (!this.token) throw new Error('GitHub state credential missing');
    const response = await this.request(`https://api.github.com/repos/${REPOSITORY}/${route}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`GitHub state ${method} failed with HTTP ${response.status}; no automatic retry`);
    return response.status === 204 ? null : response.json();
  }
  async read() {
    const ref = await this.api(`git/ref/heads/${BRANCH}`);
    const commit = await this.api(`git/commits/${ref.object.sha}`);
    const tree = await this.api(`git/trees/${commit.tree.sha}`);
    const readBlob = async name => {
      const entry = tree.tree.find(item => item.path === name && item.type === 'blob');
      if (!entry) throw new Error(`Required cloud state file missing: ${name}`);
      const blob = await this.api(`git/blobs/${entry.sha}`);
      return Buffer.from(blob.content, 'base64');
    };
    return { sha: ref.object.sha, tree: commit.tree.sha,
      ledger: JSON.parse(await readBlob('ledger.json')), encrypted: await readBlob('publisher-state.enc') };
  }
  async save(previous, ledger, encrypted) {
    const latest = await this.api(`git/ref/heads/${BRANCH}`);
    if (latest.object.sha !== previous.sha) throw new Error('Cloud state changed concurrently; abort');
    const entries = [];
    for (const [name, bytes] of [['ledger.json', Buffer.from(JSON.stringify(ledger, null, 2) + '\n')],
      ['publisher-state.enc', encrypted]]) {
      const blob = await this.api('git/blobs', 'POST', { content: bytes.toString('base64'), encoding: 'base64' });
      entries.push({ path: name, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await this.api('git/trees', 'POST', { base_tree: previous.tree, tree: entries });
    const commit = await this.api('git/commits', 'POST', {
      message: ledger.lock ? 'Claim cloud publisher run' : 'Checkpoint cloud publisher state',
      tree: tree.sha, parents: [previous.sha]
    });
    await this.api(`git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha, force: false });
    const confirmed = await this.api(`git/ref/heads/${BRANCH}`);
    if (confirmed.object.sha !== commit.sha) throw new Error('Cloud state write readback mismatch');
    return { sha: commit.sha, tree: tree.sha, ledger, encrypted };
  }
}
module.exports = { GitHubState, REPOSITORY, BRANCH };
