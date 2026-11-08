import { passwordHash, passwordParameters, safeEqual, secret } from '../cloud/crypto.mjs';
import { emailAddress, password } from '../cloud/validation.mjs';

// The local API shares the hosted API's credential policy and stored hash format.
export function installEmailAuth({ app, db, route, getUser, newSession, selectUser, ownUser, limit, fail }) {
  const byEmail = db.prepare('SELECT * FROM email_credentials WHERE email=?');
  const byUser = db.prepare('SELECT user_id FROM email_credentials WHERE user_id=?');
  app.post('/api/auth/email/link', route(async (req, res) => {
    const user = getUser(req);
    limit(`email-link-user:${user.id}`, 10, 3_600_000);
    limit(`email-link-ip:${req.socket.remoteAddress}`, 30, 3_600_000);
    if (byUser.get(user.id)) throw fail(409, 'email_already_linked');
    const email = emailAddress(req.body.email), pass = password(req.body.password, true);
    if (byEmail.get(email)) throw fail(409, 'email_exists');
    const salt = secret(16), passwordValue = await passwordHash(pass, salt);
    try {
      db.prepare('INSERT INTO email_credentials(email,user_id,password_hash,salt,parameters,verified,created_at) VALUES(?,?,?,?,?,0,?)').run(email, user.id, passwordValue, salt, JSON.stringify(passwordParameters), Date.now());
    } catch (error) {
      if (byUser.get(user.id)) throw fail(409, 'email_already_linked');
      if (byEmail.get(email)) throw fail(409, 'email_exists');
      throw error;
    }
    res.json({ user: ownUser(selectUser.get(user.id)) });
  }));

  app.post('/api/auth/email/login', route(async (req, res) => {
    limit(`email-login:${req.socket.remoteAddress}`, 30, 10 * 60_000);
    const email = emailAddress(req.body.email), pass = password(req.body.password);
    limit(`email-login-address:${email}`, 12, 10 * 60_000);
    const record = byEmail.get(email);
    // Unknown emails still take the same expensive hash path.
    const digest = await passwordHash(pass, record?.salt || 'AAAAAAAAAAAAAAAAAAAAAA');
    if (!record || !safeEqual(digest, record.password_hash)) throw fail(401, 'invalid_credentials');
    res.json(newSession(record.user_id));
  }));
}
