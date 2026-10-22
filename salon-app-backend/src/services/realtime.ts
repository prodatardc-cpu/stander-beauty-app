import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Op, type WhereOptions } from 'sequelize';
import { Server, type Socket } from 'socket.io';
import { isProduction, parseCorsOrigins } from '../config/env';
import { hasRole, policy, type Role } from '../config/permissions';
import { ActivityEvent } from '../models/ActivityEvent';
import { User } from '../models/User';
import { verifyAuthToken } from './authTokens';
import { dayKey } from './operationsService';
import type { StockAlert } from './stockService';
import type { Currency } from '../utils/money';

/**
 * Real-time notification of the changes made through the API (Socket.IO, same HTTP server).
 *
 * Controllers call emitChange() once a write has been committed (after the transaction resolves,
 * never inside it and never when it failed). An event is light: what changed, who did it and a short
 * French summary; devices reload the details through the REST routes, which apply the usual
 * permissions, so the API stays the only source of truth.
 *
 * Each event is sent only to the accounts allowed to read what it describes (same rules as
 * config/permissions.ts), kept in a ring buffer of the latest 200 events and saved in
 * activity_events, from which GET /activity lets a device catch up after a disconnection.
 */

export type ActivityActor = { email: string; role: string };
export type RealtimeEvent = {
  id: string;
  type: string;
  entity: string;
  entityId: string | null;
  at: string;
  actor: ActivityActor | null;
  summary: string;
  currency?: Currency;
  amount?: number;
  day?: string;
};

// 'history': the cash journal and counts (readHistory); 'payroll': the pay of one member
// (readAnyStaffFinancials, and that member's own account); 'everyone': any signed-in account.
type Audience = 'everyone' | 'history' | 'payroll';
type StoredEvent = { event: RealtimeEvent; audience: Audience; staffId: string | null; saved: boolean };

export type ChangeInput = {
  type: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  currency?: Currency | null;
  amount?: number | null;
  // Day (YYYY-MM-DD) of the history the change belongs to; defaults to today for money operations.
  day?: string | null;
  // Member concerned by a pay event.
  staffId?: string | null;
};

const bufferSize = 200;
const keepDays = 90;
const sessionCheckMs = 60_000;
const allRoles: Role[] = ['admin', 'cashier', 'staff', 'viewer'];
const historyEvents = new Set(['cash.adjustment', 'cash.count']);
const payrollEvents = new Set(['payroll.payout']);
const moneyEntities = new Set(['sale', 'expense', 'cash', 'payout']);

const buffer: StoredEvent[] = [];
const pendingWrites = new Set<Promise<unknown>>();
let io: Server | null = null;

const audienceOf = (type: string): Audience =>
  historyEvents.has(type) ? 'history' : payrollEvents.has(type) ? 'payroll' : 'everyone';

const roomsFor = ({ audience, staffId }: Pick<StoredEvent, 'audience' | 'staffId'>) => {
  if (audience === 'history') return policy.readHistory.map((role) => `role:${role}`);
  if (audience === 'payroll') {
    return [...policy.readAnyStaffFinancials.map((role) => `role:${role}`), ...(staffId ? [`staff:${staffId}`] : [])];
  }
  return allRoles.map((role) => `role:${role}`);
};

type Reader = { role: Role; staffId: string | null };

export const canRead = (reader: Reader, { audience, staffId }: Pick<StoredEvent, 'audience' | 'staffId'>) => {
  if (audience === 'history') return hasRole(policy.readHistory, reader.role);
  if (audience === 'payroll') return hasRole(policy.readAnyStaffFinancials, reader.role) || (Boolean(staffId) && reader.staffId === staffId);
  return true;
};

// "25 USD", "12,50 USD", "25 000 CDF": the amount in its own currency, rounded as the API rounds it.
export const describeAmount = (amount: number | string, currency: Currency) => {
  const value = Number(amount);
  const digits = currency === 'CDF' || Number.isInteger(value) ? 0 : 2;
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${currency}`;
};

const save = (stored: StoredEvent) => {
  const { event } = stored;
  const write = ActivityEvent.create({
    id: event.id, type: event.type, entity: event.entity, entityId: event.entityId, at: new Date(event.at),
    actorEmail: event.actor?.email ?? null, actorRole: event.actor?.role ?? null, summary: event.summary,
    currency: event.currency ?? null, amount: event.amount ?? null, day: event.day ?? null,
    audience: stored.audience, staffId: stored.staffId,
  })
    .then(() => { stored.saved = true; })
    // The change itself is committed: a journal that cannot be written must not fail the request.
    .catch((error: unknown) => console.warn('Activity event not saved:', error instanceof Error ? error.message : error))
    .finally(() => { pendingWrites.delete(write); });
  pendingWrites.add(write);
};

/**
 * Broadcasts a committed change and records it. Call it only after the write succeeded and its
 * transaction committed. Never throws.
 */
export const emitChange = (input: ChangeInput, actor?: ActivityActor | null): RealtimeEvent | null => {
  try {
    const now = new Date();
    const day = input.day ?? (moneyEntities.has(input.entity) ? dayKey(now) : null);
    const event: RealtimeEvent = {
      id: randomUUID(),
      type: input.type,
      entity: input.entity,
      entityId: input.entityId ?? null,
      at: now.toISOString(),
      actor: actor ? { email: actor.email, role: actor.role } : null,
      summary: input.summary.length > 255 ? `${input.summary.slice(0, 254)}…` : input.summary,
      ...(input.currency && { currency: input.currency }),
      ...(input.amount != null && Number.isFinite(Number(input.amount)) && { amount: Number(input.amount) }),
      ...(day && { day }),
    };
    const stored: StoredEvent = { event, audience: audienceOf(input.type), staffId: input.staffId ?? null, saved: false };
    buffer.push(stored);
    if (buffer.length > bufferSize) buffer.shift();
    io?.to(roomsFor(stored)).emit('activity', event);
    save(stored);
    return event;
  } catch (error) {
    console.warn('Activity event not sent:', error instanceof Error ? error.message : error);
    return null;
  }
};

// Same as emitChange when the summary needs extra reads (names…), done after the response was
// sent. A failure only loses the notification.
export const emitChangeLater = (build: () => Promise<ChangeInput | null>, actor?: ActivityActor | null) => {
  const pending = build()
    .then((input) => { if (input) emitChange(input, actor); })
    .catch((error: unknown) => console.warn('Activity event not sent:', error instanceof Error ? error.message : error))
    .finally(() => { pendingWrites.delete(pending); });
  pendingWrites.add(pending);
};

// Waits for the journal writes in progress (tests, shutdown).
export const flushActivity = async () => {
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
};

export const clearActivityBuffer = () => {
  buffer.length = 0;
};

const toEvent = (row: ActivityEvent): RealtimeEvent => ({
  id: row.id,
  type: row.type,
  entity: row.entity,
  entityId: row.entityId,
  at: new Date(row.at).toISOString(),
  actor: row.actorEmail ? { email: row.actorEmail, role: row.actorRole ?? '' } : null,
  summary: row.summary,
  ...(row.currency && { currency: row.currency as Currency }),
  ...(row.amount != null && { amount: Number(row.amount) }),
  ...(row.day && { day: row.day }),
});

/**
 * The latest events after `since` that `reader` may read, newest first (at most `limit`).
 * Read from activity_events, completed by the buffer for events whose write is still in progress;
 * the buffer alone answers when the database cannot.
 */
export const listActivity = async (reader: Reader, since: Date | null, limit = bufferSize): Promise<RealtimeEvent[]> => {
  const visibleInBuffer = buffer.filter((stored) => canRead(reader, stored) && (!since || new Date(stored.event.at) > since));
  let events: RealtimeEvent[];
  try {
    const audiences: WhereOptions[] = [{ audience: 'everyone' }];
    if (hasRole(policy.readHistory, reader.role)) audiences.push({ audience: 'history' });
    if (hasRole(policy.readAnyStaffFinancials, reader.role)) audiences.push({ audience: 'payroll' });
    else if (reader.staffId) audiences.push({ audience: 'payroll', staffId: reader.staffId });
    const rows = await ActivityEvent.findAll({
      where: { [Op.and]: [{ [Op.or]: audiences }, ...(since ? [{ at: { [Op.gt]: since } }] : [])] },
      order: [['at', 'DESC']],
      limit,
    });
    const ids = new Set(rows.map((row) => row.id));
    events = [...rows.map(toEvent), ...visibleInBuffer.filter((stored) => !ids.has(stored.event.id)).map((stored) => stored.event)];
  } catch {
    events = visibleInBuffer.map((stored) => stored.event);
  }
  return events.sort((left, right) => right.at.localeCompare(left.at)).slice(0, limit);
};

// ---------------------------------------------------------------------------------------------
// Socket.IO server

type SocketUser = { id: string; role: Role; email: string; staffId: string | null; authVersion: number };
type SocketData = { user: SocketUser; expiresAt: number | null };

const tokenExpiry = (token: string) => {
  const payload = jwt.decode(token);
  return payload && typeof payload === 'object' && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
};

// Same checks as authMiddleware: valid signature and age, active account, current authVersion.
const authenticate = async (socket: Socket, next: (error?: Error) => void) => {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const claims = typeof token === 'string' && token ? verifyAuthToken(token) : null;
  if (!claims) return next(new Error('Unauthorized'));
  try {
    const user = await User.findByPk(claims.userId);
    if (!user || user.status !== 'active' || claims.tokenVersion !== user.authVersion) return next(new Error('Unauthorized'));
    const data: SocketData = {
      user: { id: user.id, role: user.role, email: user.email, staffId: user.staffId ?? null, authVersion: user.authVersion },
      expiresAt: tokenExpiry(token as string),
    };
    socket.data = data;
    return next();
  } catch {
    return next(new Error('Unavailable'));
  }
};

// Closes the connections of an account whose sessions were revoked (sign-out everywhere, new
// password, account blocked, role changed). The device reconnects with its current token if it is
// still valid, and joins the rooms of its current role.
export const disconnectUser = (userId: string) => {
  io?.in(`user:${userId}`).disconnectSockets(true);
};

// Safety net for changes made outside the API routes (scripts) and for expired tokens.
const checkSessions = async () => {
  if (!io) return;
  const sockets = await io.fetchSockets();
  if (!sockets.length) return;
  const users = await User.findAll({ where: { id: [...new Set(sockets.map((socket) => (socket.data as SocketData).user.id))] } });
  const current = new Map(users.map((user) => [user.id, user]));
  for (const socket of sockets) {
    const { user, expiresAt } = socket.data as SocketData;
    const account = current.get(user.id);
    if (!account || account.status !== 'active' || account.authVersion !== user.authVersion || account.role !== user.role ||
        (account.staffId ?? null) !== user.staffId || (expiresAt !== null && expiresAt <= Date.now())) {
      socket.disconnect(true);
    }
  }
};

const pruneJournal = () =>
  ActivityEvent.destroy({ where: { at: { [Op.lt]: new Date(Date.now() - keepDays * 86_400_000) } } })
    .catch((error: unknown) => console.warn('Activity journal not pruned:', error instanceof Error ? error.message : error));

export const attachRealtime = (server: HttpServer) => {
  const production = isProduction();
  io = new Server(server, {
    cors: { origin: parseCorsOrigins(process.env.CORS_ORIGIN, production), methods: ['GET', 'POST'] },
    // Events are tiny; nothing else is accepted from the clients.
    maxHttpBufferSize: 10_000,
  });
  io.use(authenticate);
  io.on('connection', (socket) => {
    const { user } = socket.data as SocketData;
    void socket.join([`user:${user.id}`, `role:${user.role}`, ...(user.staffId ? [`staff:${user.staffId}`] : [])]);
  });
  const timer = setInterval(() => {
    checkSessions().catch((error: unknown) => console.warn('Realtime session check failed:', error instanceof Error ? error.message : error));
  }, sessionCheckMs);
  timer.unref();
  const pruneTimer = setInterval(() => void pruneJournal(), 86_400_000);
  pruneTimer.unref();
  void pruneJournal();
  return {
    io,
    close: async () => {
      clearInterval(timer);
      clearInterval(pruneTimer);
      await new Promise<void>((resolve) => { io?.close(() => resolve()); });
      io = null;
    },
  };
};

// Actor of a request (req.user), as shown in the activity feed.
export const actorOf = (user: { email: string; role: string } | undefined | null): ActivityActor | null =>
  user ? { email: user.email, role: user.role } : null;

// A product that went down to its low-stock threshold or ran out (stockService.alertFor).
export const emitStockAlerts = (alerts: StockAlert[], actor: ActivityActor | null) => {
  for (const alert of alerts) {
    emitChange({
      type: 'stock.alert', entity: 'product', entityId: alert.productId,
      summary: alert.level === 'out'
        ? `Rupture de stock : ${alert.name}`
        : `Stock bas : ${alert.name} (${alert.quantityStock} restant${alert.quantityStock > 1 ? 's' : ''})`,
    }, actor);
  }
};

export const receiptLabel = (receiptNumber: number | string | null | undefined) => `n°${Number(receiptNumber ?? 0)}`;
