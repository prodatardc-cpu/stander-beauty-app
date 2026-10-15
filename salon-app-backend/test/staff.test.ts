import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Appointment, Attendance, Commission, Sale, SaleItem, Staff, User } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createService, createStaffMember, workDay } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

const historyCounts = async (staffId: string) => ({
  sales: await Sale.count({ where: { staffId } }),
  saleItems: await SaleItem.count(),
  commissions: await Commission.count({ where: { staffId } }),
  attendance: await Attendance.count({ where: { staffId } }),
  appointments: await Appointment.count({ where: { staffId } }),
});

describe('staff member removal', () => {
  let server: TestServer;
  let admin: Account;
  let cashier: Account;

  before(async () => {
    await prepareDatabase();
    server = await startTestServer();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAccount('admin');
    cashier = await createAccount('cashier');
  });

  after(async () => {
    await server.close();
    await closeDatabase();
  });

  // A member with a paid-for service (sale, line, commission), a day of attendance, an appointment
  // and a linked team account.
  const memberWithHistory = async () => {
    const member = await createStaffMember();
    const service = await createService();
    const client = await createClient();
    const sale = await server.request('POST', '/sales', {
      token: cashier.token,
      body: { paymentMethod: 'cash', currency: 'USD', staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] },
    });
    assert.equal(sale.status, 201);
    const attendance = await server.request('PUT', `/attendance/${workDay}`, { token: cashier.token, body: { entries: [{ staffId: member.id, status: 'present' }] } });
    assert.equal(attendance.status, 200);
    await Appointment.create({ clientId: client.id, staffId: member.id, serviceId: service.id, scheduledAt: new Date() });
    const account = await createAccount('staff', { staffId: member.id });
    return { member, service, account };
  };

  test('removing a member with history archives them and keeps sales, commissions and attendance', async () => {
    const { member, service, account } = await memberWithHistory();
    const history = await historyCounts(member.id);
    assert.deepEqual(history, { sales: 1, saleItems: 1, commissions: 1, attendance: 1, appointments: 1 });

    const removal = await server.request('DELETE', `/staff/${member.id}`, { token: admin.token });
    assert.equal(removal.status, 200);
    assert.equal(removal.body.outcome, 'archived');
    assert.deepEqual(await historyCounts(member.id), history);
    const archived = await Staff.findByPk(member.id);
    assert.equal(archived?.status, 'inactive');
    assert.ok(archived?.archivedAt);

    const linkedAccount = await User.findByPk(account.user.id);
    assert.equal(linkedAccount?.status, 'inactive', 'linked account blocked, not deleted');
    assert.equal((await server.request('GET', '/auth/me', { token: account.token })).status, 401, 'its sessions are revoked');

    const listed = await server.request('GET', '/staff', { token: cashier.token });
    assert.ok(!listed.body.some((entry: { id: string }) => entry.id === member.id));
    const withArchived = await server.request('GET', '/staff?includeArchived=true', { token: cashier.token });
    assert.ok(withArchived.body.some((entry: { id: string }) => entry.id === member.id));

    const sale = await server.request('POST', '/sales', {
      token: cashier.token,
      body: { paymentMethod: 'cash', staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] },
    });
    assert.equal(sale.status, 400, 'no new sale for an archived member');
    const rollCall = await server.request('PUT', '/attendance/2026-10-13', { token: cashier.token, body: { entries: [] } });
    assert.equal(rollCall.status, 200, 'the archived member is no longer expected in the roll call');

    const restored = await server.request('POST', `/staff/${member.id}/restore`, { token: admin.token });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.archivedAt, null);
    assert.equal(restored.body.status, 'inactive', 'reactivation stays an explicit decision');
  });

  test('a member without any history is deleted and linked accounts are kept but blocked', async () => {
    const member = await createStaffMember();
    const account = await createAccount('cashier', { staffId: member.id });
    const removal = await server.request('DELETE', `/staff/${member.id}`, { token: admin.token });
    assert.equal(removal.body.outcome, 'deleted');
    assert.equal(await Staff.findByPk(member.id), null);
    const linkedAccount = await User.findByPk(account.user.id);
    assert.equal(linkedAccount?.status, 'inactive');
    assert.equal(linkedAccount?.staffId, null, 'unlinked by the foreign key');
  });

  test('the removal is atomic: a failure midway leaves everything unchanged', async () => {
    const { member, account } = await memberWithHistory();
    const history = await historyCounts(member.id);
    const originalUpdate = Staff.prototype.update;
    Staff.prototype.update = async function failingUpdate() {
      throw new Error('simulated failure after the linked accounts were blocked');
    } as typeof Staff.prototype.update;
    try {
      const removal = await server.request('DELETE', `/staff/${member.id}`, { token: admin.token });
      assert.equal(removal.status, 500);
    } finally {
      Staff.prototype.update = originalUpdate;
    }
    assert.equal((await User.findByPk(account.user.id))?.status, 'active', 'account change rolled back');
    assert.equal((await Staff.findByPk(member.id))?.archivedAt, null);
    assert.deepEqual(await historyCounts(member.id), history);
  });

  test('the database itself refuses to delete a member who has attendance or sales', async () => {
    const { member } = await memberWithHistory();
    // 23001 = restrict_violation, 23503 = foreign_key_violation: whichever constraint is checked first.
    await assert.rejects(
      Staff.destroy({ where: { id: member.id } }),
      (error: Error & { parent?: { code?: string } }) => ['23001', '23503'].includes(error.parent?.code ?? '')
    );
    assert.ok(await Staff.findByPk(member.id));

    // These two used to cascade (attendance deleted) or silently detach (sale.staffId set to NULL).
    const isRestrictViolation = (error: Error & { parent?: { code?: string } }) => error.parent?.code === '23001';
    const attendanceOnly = await createStaffMember();
    await Attendance.create({ staffId: attendanceOnly.id, attendanceDate: '2026-10-14', status: 'present' });
    await assert.rejects(Staff.destroy({ where: { id: attendanceOnly.id } }), isRestrictViolation);
    assert.equal(await Attendance.count({ where: { staffId: attendanceOnly.id } }), 1);

    const saleOnly = await createStaffMember();
    await Sale.create({ staffId: saleOnly.id, totalAmount: 10, amountPaid: 10, remainingAmount: 0, paymentMethod: 'cash', currency: 'USD' });
    await assert.rejects(Staff.destroy({ where: { id: saleOnly.id } }), isRestrictViolation);
    assert.equal(await Sale.count({ where: { staffId: saleOnly.id } }), 1);
  });
});
