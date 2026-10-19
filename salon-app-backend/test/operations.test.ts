import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Commission, Expense, Product, Sale, StaffPayout } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createProduct, createService, createStaffMember, localDate } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

describe('receipts, cancellations, debts, team pay and daily history', () => {
  let server: TestServer;
  let admin: Account;
  let cashier: Account;
  const today = localDate();

  const as = (account: Account) => ({
    get: (path: string) => server.request('GET', path, { token: account.token }),
    post: (path: string, body?: unknown, headers?: Record<string, string>) => server.request('POST', path, { token: account.token, body, headers }),
    put: (path: string, body: unknown) => server.request('PUT', path, { token: account.token, body }),
  });
  const sell = (body: Record<string, unknown>) => as(cashier).post('/sales', { paymentMethod: 'cash', ...body });

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

  test('A. a receipt carries the business details, a number, its lines, payments and currency', async () => {
    assert.equal((await as(admin).put('/settings', {
      businessName: 'Stander Beauty Gombe', businessEmail: 'contact@stander.example', businessPhone: '+243 990 000 000',
      taxId: 'A1234567B', businessAddress: '12 avenue du Commerce, Kinshasa',
    })).status, 200);
    assert.equal((await as(admin).put('/settings', { businessEmail: 'not-an-email' })).status, 400);
    assert.equal((await as(cashier).put('/settings', { businessName: 'X' })).status, 403);

    const product = await createProduct({ name: 'Huile', priceBuy: 4, priceSell: 10 });
    const service = await createService({ name: 'Coupe', price: 20 });
    const client = await createClient({ name: 'Mireille' });
    const first = await sell({ clientId: client.id, amountPaid: 25, items: [{ type: 'product', itemId: product.id, quantity: 2 }, { type: 'service', itemId: service.id, quantity: 1 }] });
    const second = await sell({ items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    assert.equal(first.status, 201);
    assert.equal(Number(second.body.receiptNumber), Number(first.body.receiptNumber) + 1, 'receipts are numbered in order');

    await product.update({ name: 'Huile renommée' });
    const receipt = await as(cashier).get(`/sales/${first.body.id}`);
    assert.equal(receipt.status, 200);
    assert.deepEqual(receipt.body.business, {
      businessName: 'Stander Beauty Gombe', businessEmail: 'contact@stander.example', businessPhone: '+243 990 000 000',
      taxId: 'A1234567B', businessAddress: '12 avenue du Commerce, Kinshasa',
    });
    assert.equal(receipt.body.clientLabel, 'Mireille');
    assert.equal(receipt.body.currency, 'USD');
    assert.deepEqual(receipt.body.items.map((item: { itemName: string; quantity: number; unitPrice: string; subtotal: string }) =>
      [item.itemName, item.quantity, Number(item.unitPrice), Number(item.subtotal)]).sort(), [['Coupe', 1, 20, 20], ['Huile', 2, 10, 20]]);
    assert.deepEqual([Number(receipt.body.totalAmount), Number(receipt.body.amountPaid), Number(receipt.body.remainingAmount)], [40, 25, 15]);
    assert.equal(receipt.body.payments.length, 1);
    assert.equal(receipt.body.createdByEmail, cashier.user.email);
  });

  test('B. cancelling a sale restores stock, removes it from the figures, keeps a trace and cannot happen twice', async () => {
    const product = await createProduct({ priceBuy: 4, priceSell: 10, quantityStock: 5 });
    const member = await createStaffMember({ commissionRate: 40 });
    const service = await createService({ price: 20 });
    const sale = await sell({ staffId: member.id, items: [{ type: 'product', itemId: product.id, quantity: 2 }, { type: 'service', itemId: service.id, quantity: 1 }] });
    assert.equal(sale.status, 201);
    assert.equal((await Product.findByPk(product.id))?.quantityStock, 3);

    assert.equal((await as(cashier).post(`/sales/${sale.body.id}/cancel`, { reason: 'Erreur de saisie' })).status, 403, 'cashiers cannot cancel');
    const cancelled = await as(admin).post(`/sales/${sale.body.id}/cancel`, { reason: 'Erreur de saisie' });
    assert.equal(cancelled.status, 200);
    assert.equal((await as(admin).post(`/sales/${sale.body.id}/cancel`, {})).status, 409, 'already cancelled');
    assert.equal((await server.request('DELETE', `/sales/${sale.body.id}`, { token: admin.token })).status, 409);

    assert.equal((await Product.findByPk(product.id))?.quantityStock, 5, 'stock restored once');
    const stored = await Sale.findByPk(sale.body.id);
    assert.deepEqual([stored?.status, stored?.cancelReason, stored?.cancelledByUserId], ['refunded', 'Erreur de saisie', admin.user.id]);
    assert.ok(stored?.cancelledAt);
    assert.equal(await Commission.count({ where: { cancelledAt: null } }), 0, 'commission no longer earned');
    assert.equal(await Commission.count(), 1, 'but kept on record');

    // A cancelled sale counts as if it had never happened: nothing received, nothing refunded.
    const report = await as(admin).get(`/reports/period?startDate=${today}&endDate=${today}`);
    assert.deepEqual([report.body.byCurrency.USD.totalSales, report.body.byCurrency.USD.amountReceived, report.body.byCurrency.USD.refunds, report.body.byCurrency.USD.netBalance], [0, 0, 0, 0]);
    const overview = await as(admin).get('/reports/overview');
    assert.equal(overview.body.today.USD.amountReceived, 0, 'not in the overview');
    const active = await as(cashier).get('/sales?status=completed');
    assert.equal(active.body.length, 0, 'no longer an active sale');
    let day = await as(admin).get(`/history/days/${today}`);
    assert.equal(day.body.cancellations.length, 1, 'listed in the history');
    assert.equal(day.body.cancellations[0].cancelReason, 'Erreur de saisie');
    assert.equal(day.body.journal.length, 0, 'no cash movement left');
    assert.equal((await as(admin).get('/sales?status=refunded')).body.length, 1);

    // Seven days after its cancellation it is no longer listed anywhere (kept in the database).
    await Sale.update({ cancelledAt: new Date(Date.now() - 8 * 86_400_000) }, { where: { id: sale.body.id } });
    assert.equal((await as(admin).get('/sales?status=refunded')).body.length, 0);
    assert.equal((await as(admin).get('/sales')).body.length, 0, 'nor among all sales');
    day = await as(admin).get(`/history/days/${today}`);
    assert.deepEqual([day.body.sales.length, day.body.cancellations.length], [0, 0]);
    assert.equal((await as(admin).get(`/payroll/${member.id}`)).body.services.length, 0);
    assert.ok(await Sale.findByPk(sale.body.id), 'still in the database');
  });

  test('the cashier can change a service price; the catalogue price is kept on the line', async () => {
    const service = await createService({ price: 20 });
    const member = await createStaffMember({ commissionRate: 40 });
    const sale = await sell({ staffId: member.id, expectedTotal: 15, items: [{ type: 'service', itemId: service.id, quantity: 1, unitPrice: 15 }] });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(Number(sale.body.totalAmount), 15);
    const line = sale.body.items[0];
    assert.deepEqual([Number(line.unitPrice), Number(line.catalogUnitPrice)], [15, 20]);
    assert.equal(Number((await Commission.findOne({ where: { staffId: member.id } }))?.commissionAmount), 6, '40 % of the price charged');
    const product = await createProduct({ priceSell: 10 });
    assert.equal((await sell({ items: [{ type: 'product', itemId: product.id, quantity: 1, unitPrice: 1 }] })).status, 400, 'product prices are not changed at the till');
    assert.equal((await sell({ items: [{ type: 'service', itemId: service.id, quantity: 1, unitPrice: -1 }] })).status, 400);
    const unchanged = await sell({ items: [{ type: 'service', itemId: service.id, quantity: 1, unitPrice: 20 }] });
    assert.equal(unchanged.body.items[0].catalogUnitPrice, null, 'same as the catalogue: nothing to keep');
  });

  test('a product can carry a photo taken on the device', async () => {
    const photo = `data:image/jpeg;base64,${'A'.repeat(60_000)}`;
    const created = await as(admin).post('/products', { name: 'Huile', sku: 'PHOTO-1', category: 'Soins', priceBuy: 1, priceSell: 2, imageUrl: photo });
    assert.equal(created.status, 201);
    assert.equal((await Product.findByPk(created.body.id))?.imageUrl, photo);
    assert.equal((await as(admin).post('/products', { name: 'X', sku: 'PHOTO-2', category: 'Soins', priceBuy: 1, priceSell: 2, imageUrl: 'data:text/html;base64,AAAA' })).status, 400);
    const patched = await server.request('PATCH', `/products/${created.body.id}`, { token: admin.token, body: { imageUrl: '' } });
    assert.equal(patched.status, 200);
  });

  test('C and D. services and products, USD and CDF stay apart everywhere', async () => {
    await as(admin).put('/settings', { usdToCdfRate: 2500 });
    const service = await createService({ price: 20 });
    const product = await createProduct({ priceBuy: 8, priceSell: 20 });
    assert.equal((await sell({ currency: 'USD', items: [{ type: 'service', itemId: service.id, quantity: 1 }] })).status, 201);
    assert.equal((await sell({ currency: 'CDF', items: [{ type: 'product', itemId: product.id, quantity: 1 }] })).status, 201);

    const report = await as(admin).get(`/reports/period?startDate=${today}&endDate=${today}`);
    assert.deepEqual([report.body.byCurrency.USD.serviceRevenue, report.body.byCurrency.USD.productRevenue, report.body.byCurrency.USD.amountReceived], [20, 0, 20]);
    assert.deepEqual([report.body.byCurrency.CDF.serviceRevenue, report.body.byCurrency.CDF.productRevenue, report.body.byCurrency.CDF.amountReceived], [0, 50000, 50000]);
    assert.equal(report.body.byCurrency.CDF.costOfGoods, 20000, 'purchase cost recorded at the sale');
    assert.equal(report.body.byCurrency.CDF.estimatedProfit, 30000);

    const sales = await as(admin).get(`/reports/sales?startDate=${today}&endDate=${today}`);
    assert.deepEqual(sales.body.totals.USD, { services: 20, products: 0, servicesQuantity: 1, productsQuantity: 0, total: 20 });
    assert.deepEqual(sales.body.totals.CDF, { services: 0, products: 50000, servicesQuantity: 0, productsQuantity: 1, total: 50000 });
    const productsOnly = await as(admin).get(`/reports/sales?startDate=${today}&endDate=${today}&type=product`);
    assert.deepEqual(productsOnly.body.rows.map((row: { type: string }) => row.type), ['product']);

    const cash = await as(admin).get(`/reports/cash?startDate=${today}&endDate=${today}`);
    assert.deepEqual([cash.body.totals.USD.in, cash.body.totals.CDF.in], [20, 50000]);
  });

  test('debts are settled in their currency, never beyond what is owed', async () => {
    const service = await createService({ price: 20 });
    const client = await createClient({ name: 'Grâce' });
    const sale = await sell({ clientId: client.id, amountPaid: 5, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    const debts = await as(cashier).get('/reports/debts');
    assert.deepEqual(debts.body.rows.map((row: { client: string; remainingAmount: number }) => [row.client, row.remainingAmount]), [['Grâce', 15]]);

    const key = randomUUID();
    const pay = (amount: number, idempotencyKey = randomUUID()) => as(cashier).post(`/sales/${sale.body.id}/payments`, { amount, paymentMethod: 'momo' }, { 'Idempotency-Key': idempotencyKey });
    assert.equal((await pay(16)).status, 409, 'more than owed');
    assert.equal((await pay(10, key)).status, 201);
    assert.equal((await pay(10, key)).status, 200, 'replayed, not paid twice');
    const settled = await pay(5);
    assert.equal(settled.status, 201);
    assert.deepEqual([Number(settled.body.sale.amountPaid), Number(settled.body.sale.remainingAmount)], [20, 0]);
    assert.equal((await as(cashier).get('/reports/debts')).body.rows.length, 0);
    assert.equal((await as(cashier).get('/reports/debts?status=settled')).body.rows.length, 1);
    const day = await as(admin).get(`/history/days/${today}`);
    assert.equal(day.body.debts.payments.length, 2);
  });

  test('E and F. a 40 % commission, an advance, a partial payment and the balance bring what is due to zero', async () => {
    const member = await createStaffMember({ commissionRate: 40 });
    const service = await createService({ price: 50 });
    await as(admin).put('/settings', { usdToCdfRate: 2000 });
    for (let index = 0; index < 2; index += 1) {
      assert.equal((await sell({ staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] })).status, 201);
    }
    assert.equal((await sell({ currency: 'CDF', staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] })).status, 201);

    const page = async () => (await as(admin).get(`/payroll/${member.id}`)).body;
    let pay = await page();
    assert.deepEqual([pay.byCurrency.USD.total.eligibleRevenue, pay.byCurrency.USD.total.earned, pay.byCurrency.USD.remaining], [100, 40, 40]);
    assert.deepEqual([pay.byCurrency.CDF.total.earned, pay.byCurrency.CDF.remaining], [40000, 40000], 'CDF commission stays in CDF');
    assert.equal(pay.services.length, 3);

    const payout = (kind: string, amount: number, currency = 'USD', key = randomUUID()) =>
      as(admin).post(`/payroll/${member.id}/payouts`, { kind, amount, currency }, { 'Idempotency-Key': key });
    assert.equal((await as(cashier).post(`/payroll/${member.id}/payouts`, { kind: 'advance', amount: 1, currency: 'USD' }, { 'Idempotency-Key': randomUUID() })).status, 403);
    const advanceKey = randomUUID();
    assert.equal((await payout('advance', 10, 'USD', advanceKey)).status, 201);
    assert.equal((await payout('advance', 10, 'USD', advanceKey)).status, 200, 'double click: replayed');
    assert.equal((await payout('payment', 5)).status, 201);
    pay = await page();
    assert.deepEqual([pay.byCurrency.USD.total.advances, pay.byCurrency.USD.total.payments, pay.byCurrency.USD.remaining], [10, 5, 25]);
    assert.equal((await payout('payment', 26)).status, 409, 'cannot pay more than due');
    assert.equal((await payout('payment', 25)).status, 201);
    pay = await page();
    assert.equal(pay.byCurrency.USD.remaining, 0, 'counter back to zero');
    assert.equal(pay.byCurrency.USD.total.earned, 40, 'earnings history kept');
    assert.equal(pay.byCurrency.CDF.remaining, 40000, 'other currency untouched');
    assert.equal(pay.payouts.length, 3);
    assert.equal(await StaffPayout.count(), 3);

    // Own data only for a linked team account.
    const own = await createAccount('staff', { staffId: member.id });
    assert.equal((await as(own).get(`/payroll/${member.id}`)).status, 200);
    const other = await createStaffMember();
    assert.equal((await as(own).get(`/payroll/${other.id}`)).status, 403);

    const team = await as(admin).get(`/reports/team?startDate=${today}&endDate=${today}`);
    const row = team.body.members.find((entry: { staffId: string }) => entry.staffId === member.id);
    assert.deepEqual([row.byCurrency.USD.servicesCount, row.byCurrency.USD.revenue, row.byCurrency.USD.earned, row.byCurrency.USD.advances, row.byCurrency.USD.payments, row.byCurrency.USD.remaining], [2, 100, 40, 10, 30, 0]);
  });

  test('a fixed salary earns no commission and is paid in the base currency', async () => {
    const member = await createStaffMember({ payType: 'fixed', monthlySalary: 300 });
    const service = await createService({ price: 50 });
    await sell({ staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    const page = async () => (await as(admin).get(`/payroll/${member.id}`)).body;
    let pay = await page();
    assert.deepEqual([pay.byCurrency.USD.period.earned, pay.byCurrency.USD.remaining, pay.byCurrency.USD.total.eligibleRevenue], [300, 300, 50]);
    const payout = (amount: number, currency = 'USD') =>
      as(admin).post(`/payroll/${member.id}/payouts`, { kind: 'payment', amount, currency }, { 'Idempotency-Key': randomUUID() });
    assert.equal((await payout(100, 'CDF')).status, 400);
    assert.equal((await payout(300)).status, 201);
    pay = await page();
    assert.equal(pay.byCurrency.USD.remaining, 0);
  });

  test('G. a day lists its sales, services, expenses, cash movements, debts and payouts', async () => {
    const member = await createStaffMember({ name: 'Awa', commissionRate: 40 });
    const service = await createService({ name: 'Tresses', price: 30 });
    const product = await createProduct({ name: 'Gel', priceSell: 5 });
    await sell({ staffId: member.id, amountPaid: 20, items: [{ type: 'service', itemId: service.id, quantity: 1 }] });
    await sell({ items: [{ type: 'product', itemId: product.id, quantity: 2 }] });
    const expense = await as(cashier).post('/expenses', { description: 'Eau', category: 'Fonctionnement', amount: 3, paymentMethod: 'cash' });
    const wrong = await as(cashier).post('/expenses', { description: 'Doublon', category: 'Fonctionnement', amount: 7, paymentMethod: 'cash' });
    assert.equal((await as(admin).post(`/expenses/${wrong.body.id}/cancel`, { reason: 'Saisie en double' })).status, 200);
    assert.equal((await as(admin).post(`/expenses/${wrong.body.id}/cancel`, {})).status, 409);
    assert.ok(await Expense.findByPk(wrong.body.id), 'the expense is kept');
    assert.equal((await as(cashier).post('/cash/adjustments', { direction: 'in', amount: 50, currency: 'USD', reason: 'Fond de caisse' })).status, 201);
    assert.equal((await as(admin).post(`/payroll/${member.id}/payouts`, { kind: 'advance', amount: 4, currency: 'USD' }, { 'Idempotency-Key': randomUUID() })).status, 201);

    // Cash in the drawer: 20 + 10 + 50 − 3 − 7 + 7 − 4 = 73 USD.
    const count = await as(cashier).post('/cash/counts', { currency: 'USD', countedAmount: 70 });
    assert.equal(count.status, 201);
    assert.deepEqual([Number(count.body.expectedAmount), count.body.difference], [73, -3]);

    const days = await as(cashier).get('/history/days');
    assert.equal(days.status, 200);
    assert.equal(days.body.days[0].day, today);
    assert.deepEqual([days.body.days[0].byCurrency.USD.totalSales, days.body.days[0].byCurrency.USD.debtsCreated], [40, 10]);

    const day = (await as(cashier).get(`/history/days/${today}`)).body;
    assert.equal(day.sales.length, 2);
    assert.deepEqual(day.services.map((entry: { name: string; staffName: string }) => [entry.name, entry.staffName]), [['Tresses', 'Awa']]);
    assert.deepEqual(day.products.map((entry: { name: string; quantity: number }) => [entry.name, entry.quantity]), [['Gel', 2]]);
    assert.equal(day.expenses.length, 2);
    assert.equal(day.expenses.find((entry: { id: string }) => entry.id === wrong.body.id).cancelReason, 'Saisie en double');
    assert.ok(day.expenses.find((entry: { id: string }) => entry.id === expense.body.id).createdBy);
    assert.equal(day.debts.created.length, 1);
    assert.equal(day.payouts[0].staffName, 'Awa');
    assert.deepEqual(day.journal.map((entry: { type: string }) => entry.type).sort(),
      ['adjustment', 'expense', 'expense', 'expense_cancel', 'payout', 'sale_payment', 'sale_payment']);
    assert.equal(day.cashCounts[0].difference, -3);
    assert.equal((await as(await createAccount('staff')).get(`/history/days/${today}`)).status, 403, 'not for team accounts');

    const closed = await as(cashier).post('/reports/close-day', { date: today });
    assert.equal(closed.status, 201);
    assert.ok((await as(cashier).get(`/history/days/${today}`)).body.closedAt, 'closed days stay readable');
  });

});
