import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Client, Commission, Product, Sale, SaleItem, Service, Staff } from '../src/models';
import { closeDatabase, prepareDatabase, resetDatabase } from './helpers/db';
import { createAccount, createClient, createProduct, createService, createStaffMember, localDate } from './helpers/fixtures';
import { startTestServer, type TestServer } from './helpers/http';

type Account = Awaited<ReturnType<typeof createAccount>>;

describe('salon settings and currencies', () => {
  let server: TestServer;
  let admin: Account;
  let cashier: Account;

  const settings = (token: string, body: unknown) => server.request('PUT', '/settings', { token, body });
  const sell = (body: Record<string, unknown>) => server.request('POST', '/sales', { token: cashier.token, body: { paymentMethod: 'cash', ...body } });

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

  test('settings are shared by every account and only the administrator changes them', async () => {
    const initial = (await server.request('GET', '/settings', { token: cashier.token })).body;
    assert.deepEqual([initial.baseCurrency, initial.usdToCdfRate, initial.businessName, initial.payPeriod], ['USD', null, 'Stander Beauty', 'monthly']);
    assert.equal((await settings(cashier.token, { usdToCdfRate: 2800 })).status, 403);
    for (const body of [{ usdToCdfRate: 0 }, { usdToCdfRate: '2800' }, { baseCurrency: 'EUR' }, { other: 1 }]) {
      assert.equal((await settings(admin.token, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await settings(admin.token, { baseCurrency: 'CDF' })).status, 400, 'a rate is needed to convert the prices');

    const saved = await settings(admin.token, { usdToCdfRate: 2800 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.usdToCdfRate, 2800);
    assert.equal((await server.request('GET', '/settings', { token: cashier.token })).body.usdToCdfRate, 2800, 'seen by the other accounts');
  });

  test('changing the base currency converts catalogue prices, salaries and client totals', async () => {
    const service = await createService({ price: 20, womenPrice: 25, menPrice: null });
    const product = await createProduct({ priceBuy: 4, priceSell: 10.5 });
    const member = await createStaffMember({ payType: 'fixed', monthlySalary: 300 });
    const client = await createClient({ totalSpent: 12.34 });
    await settings(admin.token, { usdToCdfRate: 2800 });

    assert.equal((await settings(admin.token, { baseCurrency: 'CDF' })).status, 200);
    await Promise.all([service.reload(), product.reload(), member.reload(), client.reload()]);
    assert.deepEqual([Number(service.price), Number(service.womenPrice), service.menPrice], [56000, 70000, null]);
    assert.deepEqual([Number(product.priceBuy), Number(product.priceSell)], [11200, 29400]);
    assert.equal(Number(member.monthlySalary), 840000);
    assert.equal(Number(client.totalSpent), 34552);

    assert.equal((await settings(admin.token, { baseCurrency: 'USD' })).status, 200);
    await service.reload();
    assert.equal(Number(service.price), 20, 'and back');
  });

  test('a sale in the other currency is priced by the API at the salon rate', async () => {
    const service = await createService({ price: 20 });
    const product = await createProduct({ priceSell: 10.5 });
    const member = await createStaffMember({ commissionRate: 40 });
    const client = await createClient();
    const items = [{ type: 'service', itemId: service.id, quantity: 1 }, { type: 'product', itemId: product.id, quantity: 2 }];

    assert.equal((await sell({ currency: 'CDF', items })).status, 400, 'no rate configured yet');
    await settings(admin.token, { usdToCdfRate: 2800 });

    // A till that still shows old prices is refused, and nothing is recorded.
    const stale = await sell({ currency: 'CDF', items, staffId: member.id, clientId: client.id, expectedTotal: 41 });
    assert.equal(stale.status, 409);
    assert.equal(await Sale.count(), 0);

    // 20 USD + 2 × 10.50 USD = 41 USD = 114 800 CDF; client sends ignored baseCurrency/exchangeRate.
    const sale = await sell({ currency: 'CDF', items, staffId: member.id, clientId: client.id, expectedTotal: 114800, baseCurrency: 'CDF', exchangeRate: 1 });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.deepEqual([Number(sale.body.totalAmount), sale.body.currency, Number(sale.body.exchangeRateUsed)], [114800, 'CDF', 2800]);
    assert.deepEqual([sale.body.baseCurrency, Number(sale.body.baseAmount)], ['USD', 41]);

    const commission = await Commission.findOne({ where: { staffId: member.id } });
    assert.deepEqual([commission?.currency, Number(commission?.commissionAmount)], ['CDF', 22400]);
    await client.reload();
    assert.equal(Number(client.totalSpent), 41, 'client totals stay in the base currency');

    const totals = await server.request('GET', `/commissions/staff/${member.id}/total`, { token: admin.token });
    assert.deepEqual(totals.body, { USD: { total: 0, paid: 0, remaining: 0 }, CDF: { total: 22400, paid: 0, remaining: 22400 } });

    assert.equal((await server.request('DELETE', `/sales/${sale.body.id}`, { token: admin.token })).status, 200);
    await client.reload();
    assert.equal(Number(client.totalSpent), 0, 'cancelling removes what the sale added');
  });

  test('women and men prices are charged and recorded, and fixed salaries earn no commission', async () => {
    const unisex = await createService({ price: 20, audience: 'unisex', womenPrice: 25, menPrice: 15 });
    const womenOnly = await createService({ price: 30, audience: 'women' });
    const salaried = await createStaffMember({ payType: 'fixed', monthlySalary: 300 });

    const men = await sell({ staffId: salaried.id, items: [{ type: 'service', itemId: unisex.id, audience: 'men', quantity: 2 }] });
    assert.equal(men.status, 201);
    assert.equal(Number(men.body.totalAmount), 30);
    const line = await SaleItem.findOne({ where: { saleId: men.body.id } });
    assert.equal(line?.audience, 'men');
    assert.equal(await Commission.count(), 0, 'no commission for a fixed salary');

    const women = await sell({ items: [{ type: 'service', itemId: unisex.id, audience: 'women', quantity: 1 }] });
    assert.equal(Number(women.body.totalAmount), 25);
    const noAudience = await sell({ items: [{ type: 'service', itemId: unisex.id, quantity: 1 }] });
    assert.equal(Number(noAudience.body.totalAmount), 20, 'base price without an audience');

    assert.equal((await sell({ items: [{ type: 'service', itemId: womenOnly.id, audience: 'men', quantity: 1 }] })).status, 400);
    assert.equal((await sell({ items: [{ type: 'service', itemId: unisex.id, audience: 'kids', quantity: 1 }] })).status, 400);
  });

  test('services and staff keep the fields the web app sends', async () => {
    const created = await server.request('POST', '/services', {
      token: admin.token,
      body: { name: 'Tresses', category: 'Coiffure', price: 40, duration: 60, audience: 'women', womenPrice: 45, menPrice: null },
    });
    assert.equal(created.status, 201);
    const service = await Service.findByPk(created.body.id);
    assert.deepEqual([service?.audience, Number(service?.womenPrice), service?.menPrice], ['women', 45, null]);
    assert.equal((await server.request('PATCH', `/services/${created.body.id}`, { token: admin.token, body: { audience: 'all' } })).status, 400);

    const member = await server.request('POST', '/staff', {
      token: admin.token,
      body: { name: 'Awa', phone: '+243990000001', position: 'Coiffeuse', payType: 'fixed', commissionRate: 0, monthlySalary: 250 },
    });
    assert.equal(member.status, 201);
    const staff = await Staff.findByPk(member.body.id);
    assert.deepEqual([staff?.payType, Number(staff?.monthlySalary)], ['fixed', 250]);
    assert.equal((await server.request('PATCH', `/staff/${member.body.id}`, { token: admin.token, body: { payType: 'hourly' } })).status, 400);
  });

  test('reports, archives and expenses keep each currency apart', async () => {
    const service = await createService({ price: 20 });
    const member = await createStaffMember({ commissionRate: 50 });
    await settings(admin.token, { usdToCdfRate: 2000 });
    assert.equal((await sell({ currency: 'USD', staffId: member.id, items: [{ type: 'service', itemId: service.id, quantity: 1 }] })).status, 201);
    assert.equal((await sell({ currency: 'CDF', staffId: member.id, amountPaid: 30000, items: [{ type: 'service', itemId: service.id, quantity: 1 }] })).status, 201);
    const expense = (body: Record<string, unknown>) => server.request('POST', '/expenses', { token: cashier.token, body: { description: 'Eau', category: 'Fonctionnement', paymentMethod: 'cash', ...body } });
    assert.equal((await expense({ amount: 5 })).body.currency, 'USD', 'base currency by default');
    assert.equal((await expense({ amount: 1000, currency: 'CDF' })).body.currency, 'CDF');
    assert.equal((await expense({ amount: 1, currency: 'EUR' })).status, 400);

    const today = localDate();
    const report = await server.request('GET', `/reports/period?startDate=${today}&endDate=${today}`, { token: cashier.token });
    assert.equal(report.status, 200);
    const figures = { refunds: 0, payroll: 0, fixedSalaryPayroll: 0, adjustmentsIn: 0, adjustmentsOut: 0, costOfGoods: 0 };
    assert.deepEqual(report.body.byCurrency.USD, {
      ...figures, totalSales: 20, amountReceived: 20, outstandingAmount: 0, serviceRevenue: 20, productRevenue: 0,
      totalExpenses: 5, netBalance: 15, totalCommissions: 10, transactionCount: 1, expenseCount: 1, estimatedProfit: 5,
    });
    assert.deepEqual(report.body.byCurrency.CDF, {
      ...figures, totalSales: 40000, amountReceived: 30000, outstandingAmount: 10000, serviceRevenue: 40000, productRevenue: 0,
      totalExpenses: 1000, netBalance: 29000, totalCommissions: 20000, transactionCount: 1, expenseCount: 1, estimatedProfit: 19000,
    });

    const closed = await server.request('POST', '/reports/close-day', { token: cashier.token, body: { date: today } });
    assert.equal(closed.status, 201);
    assert.equal(Number(closed.body.archive.amountReceived), 20, 'summary columns in the base currency');
    assert.deepEqual(closed.body.archive.breakdown.byCurrency, report.body.byCurrency);

    const overview = await server.request('GET', '/reports/overview', { token: cashier.token });
    assert.deepEqual([overview.body.today.USD.amountReceived, overview.body.today.CDF.amountReceived], [20, 30000]);
    assert.deepEqual([overview.body.payrollDue.USD, overview.body.payrollDue.CDF], [10, 20000], "commissions still due");
    assert.deepEqual(overview.body.debts.CDF, { amount: 10000, count: 1 });
  });

  test('client totals are kept in the base currency through a sale, a base change and a cancellation', async () => {
    const product = await createProduct({ priceSell: 10 });
    const client = await createClient();
    await settings(admin.token, { usdToCdfRate: 2500 });
    const sale = await sell({ clientId: client.id, items: [{ type: 'product', itemId: product.id, quantity: 1 }] });
    assert.equal(sale.status, 201);
    await settings(admin.token, { baseCurrency: 'CDF' });
    await client.reload();
    assert.equal(Number(client.totalSpent), 25000);
    assert.equal((await server.request('DELETE', `/sales/${sale.body.id}`, { token: admin.token })).status, 200);
    await client.reload();
    assert.equal(Number(client.totalSpent), 0);
    assert.equal((await Product.findByPk(product.id))?.quantityStock, 10, 'stock restored');
    assert.equal(Number((await Client.findByPk(client.id))?.totalSpent), 0);
  });
});
