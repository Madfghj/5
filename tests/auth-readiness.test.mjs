import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/auth-readiness.mjs', import.meta.url));

test('readiness skips unconfigured providers, uses opt-in starts and never outputs OAuth values', async t => {
  let starts = 0, opens = 0;
  const server = createServer(async (req, res) => {
    const origin = `http://${req.headers.host}`;
    if (req.url === '/api/auth/providers') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(['google','apple','microsoft','telegram'].map(id => ({ id, configured: id === 'google' }))));
    } else if (req.url === '/api/auth/google/start') {
      starts++;
      let body = ''; for await (const chunk of req) body += chunk;
      assert.match(JSON.parse(body).codeChallenge, /^[A-Za-z0-9_-]{43}$/);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({url: `${origin}/api/auth/google/authorize?state=do-not-print-state&ticket=do-not-print-ticket`}));
    } else if (req.url.startsWith('/api/auth/google/authorize')) {
      opens++;
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key,value] of Object.entries({client_id:'do-not-print-client',state:'do-not-print-state',nonce:'do-not-print-nonce',redirect_uri:`${origin}/api/auth/google/callback`,response_type:'code',scope:'openid profile email',code_challenge_method:'S256'})) target.searchParams.set(key,value);
      res.writeHead(303, { Location:target.href, 'Set-Cookie':'oc_test=do-not-print-cookie; Path=/api/auth/google/callback; HttpOnly; SameSite=None; Secure' });
      res.end();
    } else { res.writeHead(404);res.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const passive = await run(process.execPath,[script,'--origin',origin],{env:{...process.env,AUTH_READINESS_PROBE_STARTS:'0'}});
  assert.equal(starts,0);assert.equal(opens,0);
  assert.equal(JSON.parse(passive.stdout).providers[0].authorizationProbe,'not_requested');
  const active = await run(process.execPath,[script,'--origin',origin,'--probe-starts']);
  const result = JSON.parse(active.stdout);
  assert.equal(starts,1);assert.equal(opens,1);
  assert.equal(result.liveLoginVerified,false);
  assert.equal(result.providers[0].authorizationProbe,'redirect_ready');
  assert.equal(result.providers[0].browserBindingCookie.httpOnly,true);
  assert.equal(result.providers[0].callbackMatches,true);
  assert(result.providers.slice(1).every(value => value.authorizationProbe === 'skipped_unconfigured'));
  for (const value of ['do-not-print-state','do-not-print-ticket','do-not-print-client','do-not-print-nonce','do-not-print-cookie']) assert(!active.stdout.includes(value));
});

test('readiness rejects a credential-bearing origin before issuing requests', async () => {
  await assert.rejects(run(process.execPath,[script,'--origin','https://user:secret@example.test']),error => error.code === 2 && !error.stdout.includes('secret'));
});
