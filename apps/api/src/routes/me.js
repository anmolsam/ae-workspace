import { Router } from 'express';
import { TASK_STATE, applyManualCheck, applyManualUncheck } from '@ae-workspace/shared';
import { requireAuth } from '../auth/middleware.js';
import { syncTasksForOwner, buildTaskeeView } from '../services/followup-query.js';
import { getFightScoreForOwner, getFightScoreOverall, listAes } from '../services/roma-fight-score.js';
import { getFunnelForOwner, getFunnelOverall } from '../services/roma-funnel.js';
import { getUpcomingMeetings, getBrief, generateBrief } from '../services/brief-generation.js';
import { getMeetingsFromAirtable, getBriefFromAirtable, requeueBriefFromAirtable } from '../services/briefy-airtable-service.js';
import { getTaskById, updateTask } from '../db/tasks-repo.js';
import { config } from '../config/index.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const ADMIN_ROLES = new Set(['ADMIN', 'REVOPS_ADMIN', 'SALES_LEADERSHIP']);
const isAdmin = (req) => ADMIN_ROLES.has(req.ae.role);

/**
 * The owner id whose data to serve. Regular AEs always get their own
 * (req.ae.ownerId) — a tampered header is ignored, preserving isolation. Admins
 * may target any AE via the `x-view-as-owner` header (set by the AE picker).
 */
function viewOwner(req) {
  const target = req.headers['x-view-as-owner'];
  if (target && isAdmin(req)) return String(target);
  return req.ae.ownerId;
}

/** Identity for the app shell greeting + role. */
meRouter.get('/', (req, res) => {
  res.json({ email: req.ae.email, aeName: req.ae.aeName, role: req.ae.role, isAdmin: isAdmin(req) });
});

/** Admin only: the full AE roster (for the "view as AE" picker). */
meRouter.get('/aes', async (req, res, next) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  try {
    res.json({ aes: await listAes() });
  } catch (err) { next(err); }
});

/** Taskee list. Lightweight status-only sync on load (cron does the heavy
 *  activity reads). Overdue always sorted to the top inside buildTaskeeView. */
meRouter.get('/follow-ups', async (req, res, next) => {
  try {
    const owner = viewOwner(req);
    if (!owner) return res.json({ followUps: [], summary: { dueToday: 0, overdue: 0, thisWeek: 0 } });
    const { tasks } = await syncTasksForOwner(owner, { checkActivity: false });
    res.json(buildTaskeeView(tasks));
  } catch (err) { next(err); }
});

/** Manual check — instant UI feedback; NOT authoritative. Sets pending state. */
meRouter.post('/follow-ups/:id/check', async (req, res, next) => {
  try {
    const task = await getTaskById(req.params.id, req.ae.ownerId); // isolation: owner-scoped
    if (!task) return res.status(404).json({ error: 'not_found' });
    if (task.state === TASK_STATE.COMPLETED_VERIFIED) return res.json(task);
    const patched = applyManualCheck({ ...task, overdueAt: task.overdue_at });
    const saved = await updateTask(task.id, { state: patched.state, manual_checked_at: patched.manualCheckedAt });
    res.json(saved);
  } catch (err) { next(err); }
});

/** Manual uncheck — return to active/overdue by the 24h rule. */
meRouter.post('/follow-ups/:id/uncheck', async (req, res, next) => {
  try {
    const task = await getTaskById(req.params.id, req.ae.ownerId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    if (task.state === TASK_STATE.COMPLETED_VERIFIED) return res.json(task); // can't un-verify HubSpot truth
    const patched = applyManualUncheck({ ...task, overdueAt: task.overdue_at });
    const saved = await updateTask(task.id, { state: patched.state, manual_checked_at: null });
    res.json(saved);
  } catch (err) { next(err); }
});

// Admin with no AE selected → team-wide aggregate (they have no personal AE).
const adminSelfView = (req) => isAdmin(req) && !req.headers['x-view-as-owner'];

meRouter.get('/funnel', async (req, res, next) => {
  try {
    const funnel = adminSelfView(req) ? await getFunnelOverall() : await getFunnelForOwner(viewOwner(req));
    if (!funnel) return res.status(404).json({ error: 'no_funnel_data', message: 'No ROMA funnel data for this AE.' });
    res.json(funnel);
  } catch (err) { next(err); }
});

meRouter.get('/fight-score', async (req, res, next) => {
  try {
    const fs = adminSelfView(req) ? await getFightScoreOverall() : await getFightScoreForOwner(viewOwner(req));
    if (!fs) return res.status(404).json({ error: 'no_fight_score', message: 'No ROMA Fight Score for this AE.' });
    res.json(fs);
  } catch (err) { next(err); }
});

meRouter.get('/meetings', async (req, res, next) => {
  try {
    // Briefy source = the briefy-final Airtable base (real briefs) when enabled;
    // otherwise the Google Calendar path. Admins can view any AE via viewOwner.
    if (config.briefyAirtable.enabled) {
      return res.json(await getMeetingsFromAirtable({ ...req.ae, ownerId: viewOwner(req) }));
    }
    const googleToken = req.headers['x-google-token'] || null;
    res.json(await getUpcomingMeetings(req.ae, googleToken));
  } catch (err) { next(err); }
});

/** Trigger (or refresh) brief generation for one meeting. Async lifecycle. */
meRouter.post('/meetings/:id/generate-brief', async (req, res, next) => {
  try {
    if (config.briefyAirtable.enabled) {
      // Re-queue the Airtable row; the deployed Briefy engine rebuilds it.
      return res.status(202).json(await requeueBriefFromAirtable(req.params.id));
    }
    const googleToken = req.headers['x-google-token'] || null;
    const { meetings } = await getUpcomingMeetings(req.ae, googleToken);
    const meeting = meetings.find((m) => m.id === req.params.id);
    if (!meeting) return res.status(404).json({ error: 'meeting_not_found' });
    // Kick off generation; return immediately with a queued status (fire-and-forget).
    generateBrief({ ownerId: req.ae.ownerId, meeting: { id: meeting.id, company: meeting.company, attendees: meeting.attendees, externalDomain: meeting.company } })
      .catch((e) => console.error('[brief] generation failed', meeting.id, e.message));
    res.status(202).json({ status: 'queued', meetingId: meeting.id });
  } catch (err) { next(err); }
});

meRouter.get('/briefs/:briefId', async (req, res, next) => {
  try {
    const brief = config.briefyAirtable.enabled
      ? await getBriefFromAirtable(req.params.briefId)
      : await getBrief(req.params.briefId, req.ae.ownerId);
    if (!brief) return res.status(404).json({ error: 'not_found' });
    res.json(brief);
  } catch (err) { next(err); }
});
