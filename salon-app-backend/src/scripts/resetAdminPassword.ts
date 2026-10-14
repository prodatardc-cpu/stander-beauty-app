import { sequelize } from '../config/database';
import { User } from '../models/User';

const readHidden = (label: string): Promise<string> => {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command directly in an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Password reset cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
};

const resetAdminPassword = async () => {
  await sequelize.authenticate();
  await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0');
  await sequelize.transaction(async (transaction) => {
    const administrators = await User.findAll({
      where: { role: 'admin' },
      limit: 2,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (administrators.length !== 1) {
      throw new Error(`Expected exactly one administrator account; found ${administrators.length === 0 ? 'none' : 'multiple'}.`);
    }

    const password = await readHidden('Nouveau mot de passe administrateur (12 caractères minimum) : ');
    const confirmation = await readHidden('Confirmer le nouveau mot de passe : ');
    if (password.length < 12) throw new Error('The administrator password must contain at least 12 characters.');
    if (password !== confirmation) throw new Error('The passwords do not match.');

    const admin = administrators[0];
    await admin.update({ passwordHash: password, authVersion: admin.authVersion + 1 }, { transaction });
  });
  console.log('Administrator password updated; previous sessions have been revoked.');
};

resetAdminPassword()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Administrator password reset failed.');
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
