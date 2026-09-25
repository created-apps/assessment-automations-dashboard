import { config } from './config';

/**
 * The exact wording that goes out to families, kept in one place so the
 * copy can be edited without going near the dispatch logic.
 */

export interface StudentContext {
  studentName: string;
  deadline: string;
}

export function computerScienceAssessment(ctx: StudentContext): string {
  return (
    `Hi ${ctx.studentName}, kindly fill out these learning assessments so we can accurately match you with a mentor.\n` +
    `Computer science assessment: ${config.assessments.computerScience}\n` +
    `Finish these by ${ctx.deadline} and message on the group when done. ` +
    `Within 1-2 days of your assessment completion, we’ll add your mentor to the group. ` +
    `Please reach out if you have any questions. Looking forward to working with you!`
  );
}

export function prototypingAssessment(ctx: StudentContext): string {
  return (
    `Hi ${ctx.studentName}, kindly fill out these learning assessments so we can accurately match you with a mentor.\n\n` +
    `Prototyping Assessment:\n${config.assessments.prototyping}\n\n` +
    `Finish these by ${ctx.deadline} and message on the group when done. ` +
    `Within 1-2 days of your assessment completion, we’ll add your mentor to the group. ` +
    `Please reach out if you have any questions. Looking forward to working with you!`
  );
}

export function bookingInvite(host: { name: string; url: string }): string {
  return `Hi,\nPlease use this link to book a session with ${host.name}: ${host.url}`;
}

/** The mentor's introduction goes into the group as written in the directory. */
export function mentorIntroduction(intro: string): string {
  return intro;
}

/** Posted to Slack when a student's email appears in an assessment's responses. */
export function assessmentCompleted(input: {
  studentName: string;
  studentEmail: string | null;
  groupName: string;
  caseId: string;
  dashboardUrl?: string;
}, kind: 'CS_ASSESSMENT' | 'PROTOTYPING_ASSESSMENT'): string {
  const label = kind === 'CS_ASSESSMENT' ? 'Computer Science' : 'Prototyping';
  const who = input.studentEmail
    ? `${input.studentName} (${input.studentEmail})`
    : input.studentName;
  const link = input.dashboardUrl
    ? `\n${input.dashboardUrl}/cases/${input.caseId}`
    : '';
  return `:white_check_mark: *${label} assessment completed* by ${who} — group "${input.groupName}".${link}`;
}

/** Sent privately to the mentor after they're introduced, with the group link. */
/** Someone a message can address: mentioned by number when we have one. */
export interface Taggable {
  name: string;
  /** Digits only. Absent means they can only be named, not mentioned. */
  phone?: string | null;
}

/** A message and the contacts WhatsApp should turn into real mentions. */
export interface TaggedMessage {
  message: string;
  /** JIDs, for periskope.sendMessage's `mentions`. */
  mentions: string[];
}

/**
 * The token that addresses one person, and the JID that makes it a mention.
 *
 * WhatsApp only renders a mention where the body holds `@<digits>` and the
 * send carries the matching JID, so the number -- not the name -- is what goes
 * in the text. It is displayed as the contact's name in the client, so nobody
 * sees the digits. Without a number there is nothing to mention, and the name
 * is written instead so the message still reads as addressed to them.
 */
function tag(person: Taggable): { token: string; jid: string } {
  const digits = (person.phone ?? '').replace(/\D/g, '');
  if (!digits) return { token: `@${person.name}`, jid: '' };
  return { token: `@${digits}`, jid: `${digits}@c.us` };
}

/**
 * The morning ask about the first class, addressed to the student and mentor.
 */
export function firstClassPrompt(input: {
  student: Taggable;
  /**
   * Omitted when the case has no mentor recorded. The question is addressed to
   * the group either way -- who to book with is not what is being asked.
   */
  mentor?: Taggable | null;
}): TaggedMessage {
  const student = tag(input.student);
  const mentor = input.mentor ? tag(input.mentor) : null;
  const who = [student.token, mentor?.token].filter(Boolean).join(' ');
  return {
    message: `${who} when would you like to schedule your first class?`,
    mentions: [student.jid, ...(mentor ? [mentor.jid] : [])].filter(Boolean),
  };
}

export function mentorGroupInvite(groupName: string, inviteLink: string): string {
  return (
    `Hi! You've been assigned as the mentor for "${groupName}".\n` +
    `Please join the WhatsApp group here: ${inviteLink}`
  );
}

export interface CaseSummary {
  /** Present for stored cases; absent when summarising an intake not yet saved. */
  caseId?: string | null;
  groupName: string;
  studentName: string;
  studentPhone?: string | null;
  studentEmail?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  projectName?: string | null;
  chatId: string;
  source?: string | null;
  sheetRow?: number | null;
  inviteLink?: string | null;
}

function detailLines(c: CaseSummary): string {
  const rows: [string, string | null | undefined][] = [
    ['Student', c.studentName],
    ['Student phone', c.studentPhone],
    ['Student email', c.studentEmail],
    ['Parent', c.parentName],
    ['Parent phone', c.parentPhone],
    ['Project', c.projectName],
    ['Chat id', c.chatId],
    ['Invite link', c.inviteLink],
    [
      'Source',
      c.source ? `${c.source}${c.sheetRow ? ` (row ${c.sheetRow})` : ''}` : null,
    ],
  ];

  return rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `• *${label}:* ${value}`)
    .join('\n');
}

/** Deep link to one group in the dashboard, when a base URL is configured. */
function caseLink(caseId: string | null): string {
  if (!config.dashboard.url || !caseId) return config.dashboard.url || '';
  return `${config.dashboard.url}/groups/${caseId}`;
}

/**
 * The message that opens a thread when a new group is created.
 *
 * Purely a notification now. Instructions used to be typed as replies here;
 * they are taken in the dashboard instead, so this points there rather than
 * listing commands that would no longer be read.
 */
export function newGroupPrompt(c: CaseSummary): string {
  const link = caseLink(c.caseId ?? null);

  return (
    `*New group created:* ${c.groupName}\n` +
    `${detailLines(c)}\n\n` +
    (link
      ? `Decide what to send from the dashboard: ${link}`
      : 'Decide what to send from the operations dashboard.')
  );
}

/**
 * The daily "has a mentor been picked yet?" reminder.
 *
 * Repeats the group details rather than pointing at the message above it, so
 * whoever sees it knows which group is meant without scrolling the thread.
 *
 * Names both ways forward. A mentor won't always have been decided by the time
 * this lands, and "not yet" shouldn't be a dead end -- sending a booking link
 * is the other thing that moves the group along.
 */
export function mentorNudge(c: CaseSummary, daysOpen: number): string {
  const link = caseLink(c.caseId ?? null);

  return (
    `*Mentor still not assigned* — ${c.groupName} ` +
    `(open ${daysOpen} day${daysOpen === 1 ? '' : 's'})\n` +
    `${detailLines(c)}\n\n` +
    'Assign a mentor to close this off, or send a booking link to keep it ' +
    'moving' +
    (link ? `: ${link}` : ' from the operations dashboard.')
  );
}

/**
 * The sheet names a mentor nobody can find.
 *
 * Written to be actionable without opening anything: it quotes the row's own
 * values back, says which of the two lookups failed, and offers the nearest
 * directory names so an obvious typo can be fixed from the message itself.
 *
 * Said once per distinct bad value -- see sql/011_mentor_alert.sql -- so it
 * stays something worth reading rather than an hourly repetition.
 */
export function mentorNotFound(input: {
  caseId: string;
  groupName: string;
  studentName: string;
  sheetRow: number;
  mentorName: string;
  mentorEmail: string;
  reason: string;
  suggestions: string[];
}): string {
  const link = caseLink(input.caseId);
  const named = [
    input.mentorName ? `name *${input.mentorName}*` : '',
    input.mentorEmail ? `email *${input.mentorEmail}*` : '',
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    `:warning: *Mentor not found* — ${input.groupName} (${input.studentName})\n` +
    `Row ${input.sheetRow} of the intake sheet gives ${named}, but ${input.reason}.\n` +
    (input.suggestions.length
      ? `Nearest directory entries: ${input.suggestions.join(', ')}\n`
      : '') +
    'No introduction has been queued. Correct the row, or add the mentor' +
    (link ? ` from the dashboard: ${link}` : ' in the dashboard.')
  );
}

export function nudgeGivenUp(c: CaseSummary, days: number): string {
  const link = caseLink(c.caseId ?? null);

  return (
    `No mentor was assigned for *${c.groupName}* (${c.studentName}) after ${days} days, ` +
    'so I’ll stop reminding here. The group stays actionable in the dashboard ' +
    `whenever it’s decided${link ? `: ${link}` : '.'}`
  );
}
